import { Router } from 'express';

const router = Router();

interface Tolerances {
  maxDTE?: number;
  minROI?: number;
  maxBeta?: number;
  maxDelta?: number;
}

interface Trade {
  symbol: string;
  tradeDate: string;       // YYYY-MM-DD
  expirationDate: string;  // YYYY-MM-DD
  type: 'put' | 'call';
  strike: number;
  bid: number;
  supportLevel: number;
  beta: number;
  delta: number;
}

router.post('/', (req, res) => {
  const { tolerances, trades }: { tolerances: Tolerances; trades: Trade[] } = req.body;

  if (!Array.isArray(trades) || trades.length === 0) {
    return res.status(400).json({ error: 'No trades provided' });
  }

  const results = trades.map((trade) => {
    // Calculate DTE
    const dte = Math.max(
      1,
      Math.ceil(
        (new Date(trade.expirationDate).getTime() - new Date(trade.tradeDate).getTime()) /
        (1000 * 60 * 60 * 24)
      )
    );

    // Premium
    const premium = trade.bid * 100;

    // Breakeven
    const breakeven =
      trade.type === 'put'
        ? trade.strike - trade.bid
        : trade.strike + trade.bid;

    // Annual ROI
    const annualROI = ((trade.bid * 100) / (trade.strike * 100)) / dte * 365;

    // Scoring
    let score = 0;
    let totalPossible = 0;

    if (tolerances.minROI !== undefined) {
      totalPossible += 40;
      if (annualROI >= tolerances.minROI) score += 40;
      else score += Math.max(0, (annualROI / tolerances.minROI) * 40);
    }

    if (tolerances.maxDelta !== undefined) {
      totalPossible += 30;
      if (trade.delta <= tolerances.maxDelta) score += 30;
      else score += Math.max(0, ((tolerances.maxDelta / trade.delta) * 30));
    }

    if (tolerances.maxDTE !== undefined) {
      totalPossible += 20;
      if (dte <= tolerances.maxDTE) score += 20;
      else score += Math.max(0, ((tolerances.maxDTE / dte) * 20));
    }

    if (tolerances.maxBeta !== undefined) {
      totalPossible += 10;
      if (trade.beta <= tolerances.maxBeta) score += 10;
      else score += Math.max(0, ((tolerances.maxBeta / trade.beta) * 10));
    }

    // Normalize score if some tolerances are blank
    const finalScore = totalPossible > 0 ? (score / totalPossible) * 100 : 100;

    // Suggestion
    let suggestion: 'Green' | 'Yellow' | 'Red' = 'Green';
    if (finalScore >= 85) suggestion = 'Green';
    else if (finalScore >= 60) suggestion = 'Yellow';
    else suggestion = 'Red';

    return {
      ...trade,
      premium,
      breakeven,
      annualROI: annualROI.toFixed(4),
      dte,
      score: finalScore.toFixed(1),
      suggestion
    };
  });

  res.json(results);
});

export default router;
