import { Router } from "express";

const router = Router();

interface Tolerances {
  maxDTE?: number;
  minROI?: number;   // decimal (0.20 = 20%)
  maxBeta?: number;
  maxDelta?: number; // decimal (0.30 = 30%)
}

interface Trade {
  symbol: string;
  tradeDate: string;       // YYYY-MM-DD
  expirationDate: string;  // YYYY-MM-DD
  type: "put" | "call";
  strike: number;
  bid: number;
  supportLevel?: number;   // optional
  beta: number;
  delta: number;           // decimal (0.20 = 20%)
}

type Suggestion = "Conservative" | "Neutral" | "Aggressive";

router.post("/", (req, res) => {
  const { tolerances, trades }: { tolerances: Tolerances; trades: Trade[] } = req.body;

  if (!Array.isArray(trades) || trades.length === 0) {
    return res.status(400).json({ error: "No trades provided" });
  }

  const results = trades.map((trade) => {
    // --- DTE (integer, no TZ drift) ---
    const dte = Math.max(
      1,
      Math.ceil(
        (new Date(trade.expirationDate).getTime() -
          new Date(trade.tradeDate).getTime()) /
          (1000 * 60 * 60 * 24)
      )
    );

    // --- Base metrics ---
    const premium = trade.bid * 100;
    const breakeven =
      trade.type === "put"
        ? trade.strike - trade.bid
        : trade.strike + trade.bid;

    // Annualized ROI (decimal): (bid/strike) * (365 / dte)
    const annualROI = (trade.strike > 0 ? (trade.bid / trade.strike) : 0) * (365 / dte);

    // --- Collateral & Support Variance ---
    const collateralAtRisk = trade.strike * 100;
    const supportVariancePct =
      trade.type === "put" && typeof trade.supportLevel === "number" && trade.strike > 0
        ? ((trade.supportLevel - trade.strike) / trade.strike) * 100
        : null;

    // --- Hard fail (ROI only) ---
    const hardFailThreshold = (typeof tolerances?.minROI === "number" ? tolerances.minROI : 0.30);
    const hardFail = annualROI < hardFailThreshold;

    // Prepare breakdown structure
    type Part = {
      key: string;
      label: string;
      max: number;
      earned: number;
      note?: string;
    };
    const breakdown: Part[] = [];

    if (hardFail) {
      // Still provide minimal breakdown for clarity
      breakdown.push({
        key: "roi-hard-fail",
        label: "Annual ROI",
        max: 35,
        earned: 0,
        note: `Hard fail: ROI ${ (annualROI*100).toFixed(1)}% < ${ (hardFailThreshold*100).toFixed(1)}%`,
      });

      return {
        ...trade,
        premium,
        breakeven,
        annualROI: parseFloat(annualROI.toFixed(4)),
        dte,
        score: 0,
        suggestion: "Aggressive" as Suggestion, // auto-bottom bucket on hard fail
        collateralAtRisk,
        supportVariancePct,
        hardFail,
        breakdown,
        totalPossible: 35, // show what ROI would have contributed
        pointsBeforePenalties: 0,
        penaltiesApplied: 0,
        pointsFinal: 0,
      };
    }

    // ====== Scoring (no hard fail) ======
    let score = 0;
    let totalPossible = 0;

    // Helper: convex heavy penalty when exceeding tolerance
    // If within tol → full points
    // If exceeding → points * (tol/value)^2 (squared penalty)
    const heavyPenalty = (val: number, tol: number) => {
      if (val <= tol) return 1; // full
      const ratio = tol > 0 ? tol / val : 0; // < 1
      const scaled = Math.max(0, Math.min(1, ratio * ratio));
      return scaled;
    };

    // We'll also apply a small "global penalty pool" up to 15 points for exceedances.
    // Each exceeded tolerance will contribute a fraction of this pool based on severity.
    let penaltyPool = 0; // total deductions (added later as negative)
    const maxPenaltyPool = 15;

    const addPenaltyFromExceedance = (overRatio: number) => {
      // overRatio = value/tol (>=1 when exceeding)
      if (overRatio <= 1) return 0;
      // Map severity into 0..1 using smooth curve; e.g. 1.0→0; 1.5→~0.35; 2.0→~0.58; 3.0→~0.75
      const sev = Math.max(0, 1 - (1 / overRatio)); // 0..(→1)
      return sev;
    };

    // ROI (35) — Only if minROI exists; otherwise still score proportionally vs default?
    // We keep old behavior: if user provided minROI, it counts; else skip (prevents dilution).
    if (typeof tolerances?.minROI === "number") {
      const W = 35;
      totalPossible += W;
      if (annualROI >= tolerances.minROI) {
        score += W;
        breakdown.push({ key: "roi", label: "Annual ROI", max: W, earned: W, note: "Meets or exceeds minimum ROI" });
      } else {
        const earned = Math.max(0, (annualROI / tolerances.minROI) * W);
        score += earned;
        breakdown.push({
          key: "roi",
          label: "Annual ROI",
          max: W,
          earned,
          note: `Below min ROI (${(annualROI*100).toFixed(1)}% vs ${(tolerances.minROI*100).toFixed(1)}%)`,
        });
      }
    }

    // Delta (25)
    if (typeof tolerances?.maxDelta === "number" && tolerances.maxDelta > 0) {
      const W = 25;
      totalPossible += W;
      if (trade.delta <= tolerances.maxDelta) {
        score += W;
        breakdown.push({ key: "delta", label: "Delta", max: W, earned: W, note: "Within max delta" });
      } else {
        // heavy penalty: squared
        const factor = heavyPenalty(trade.delta, tolerances.maxDelta);
        const earned = W * factor;
        score += earned;
        breakdown.push({
          key: "delta",
          label: "Delta",
          max: W,
          earned,
          note: `Exceeds max delta (${(trade.delta*100).toFixed(1)}% > ${(tolerances.maxDelta*100).toFixed(1)}%)`,
        });
        penaltyPool += addPenaltyFromExceedance(trade.delta / tolerances.maxDelta);
      }
    }

    // DTE (15)
    if (typeof tolerances?.maxDTE === "number" && tolerances.maxDTE > 0) {
      const W = 15;
      totalPossible += W;
      if (dte <= tolerances.maxDTE) {
        score += W;
        breakdown.push({ key: "dte", label: "DTE", max: W, earned: W, note: "Within max DTE" });
      } else {
        const factor = heavyPenalty(dte, tolerances.maxDTE);
        const earned = W * factor;
        score += earned;
        breakdown.push({
          key: "dte",
          label: "DTE",
          max: W,
          earned,
          note: `Exceeds max DTE (${dte}d > ${tolerances.maxDTE}d)`,
        });
        penaltyPool += addPenaltyFromExceedance(dte / tolerances.maxDTE);
      }
    }

    // Beta (5)
    if (typeof tolerances?.maxBeta === "number" && tolerances.maxBeta > 0) {
      const W = 5;
      totalPossible += W;
      if (trade.beta <= tolerances.maxBeta) {
        score += W;
        breakdown.push({ key: "beta", label: "Beta", max: W, earned: W, note: "Within max beta" });
      } else {
        const factor = heavyPenalty(trade.beta, tolerances.maxBeta);
        const earned = W * factor;
        score += earned;
        breakdown.push({
          key: "beta",
          label: "Beta",
          max: W,
          earned,
          note: `Exceeds max beta (${trade.beta.toFixed(2)} > ${tolerances.maxBeta.toFixed(2)})`,
        });
        penaltyPool += addPenaltyFromExceedance(trade.beta / tolerances.maxBeta);
      }
    }

    // Collateral at risk (10) — always considered
    {
      const W = 10;
      totalPossible += W;
      let earned = 2;
      let note = "High collateral";
      if (collateralAtRisk < 20000) { earned = 10; note = "Low collateral"; }
      else if (collateralAtRisk <= 50000) { earned = 5; note = "Moderate collateral"; }
      score += earned;
      breakdown.push({ key: "collateral", label: "Collateral at Risk", max: W, earned, note });
    }

    // Support variance (10) — only if provided for puts
    if (supportVariancePct !== null) {
      const W = 10;
      totalPossible += W;
      let earned = 2;
      let note = "Support variance < 5%";
      if (supportVariancePct >= 10) { earned = 10; note = "Strong support buffer (≥10%)"; }
      else if (supportVariancePct >= 5) { earned = 5; note = "Moderate support buffer (5–10%)"; }
      score += earned;
      breakdown.push({ key: "support", label: "Support Variance %", max: W, earned, note });
    }

    // Apply the global penalty pool (up to 15 points)
    // Normalize sev sum to 0..1 and multiply by maxPenaltyPool
    const penaltiesApplied = Math.min(maxPenaltyPool, maxPenaltyPool * Math.max(0, Math.min(1, penaltyPool)));
    const pointsBeforePenalties = score;
    const pointsFinal = Math.max(0, score - penaltiesApplied);

    const finalScore = totalPossible > 0 ? (pointsFinal / totalPossible) * 100 : 100;

    // New suggestion bands
    let suggestion: Suggestion = "Aggressive";
    if (finalScore >= 90) suggestion = "Conservative";
    else if (finalScore >= 70) suggestion = "Neutral";
    else suggestion = "Aggressive";

    return {
      ...trade,
      premium,
      breakeven,
      annualROI: parseFloat(annualROI.toFixed(4)),
      dte,
      score: parseFloat(finalScore.toFixed(1)),
      suggestion,
      collateralAtRisk,
      supportVariancePct,
      hardFail: false,
      breakdown,
      totalPossible,
      pointsBeforePenalties: parseFloat(pointsBeforePenalties.toFixed(2)),
      penaltiesApplied: parseFloat(penaltiesApplied.toFixed(2)),
      pointsFinal: parseFloat(pointsFinal.toFixed(2)),
    };
  });

  res.json(results);
});

export default router;
