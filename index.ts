import express from "express";
import cors, { CorsOptions } from "cors";
import dotenv from "dotenv";
import evaluateTradesRoute from "./evaluatetrades";

dotenv.config();

const app = express();

// -------- CORS configuration --------
// Env vars:
// CORS_ORIGIN           -> comma-separated exact origins (e.g. https://app.vercel.app,https://www.yourdomain.com)
// CORS_PREVIEW_SUFFIX   -> suffix to allow previews, e.g. ".vercel.app" (optional)
// CORS_LOCAL            -> e.g. "http://localhost:3000" (optional)

const exactOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

const previewSuffix = (process.env.CORS_PREVIEW_SUFFIX || "").trim(); // e.g. ".vercel.app"
const localOrigin = (process.env.CORS_LOCAL || "").trim();

const corsOptions: CorsOptions = {
  origin(origin, cb) {
    // Allow same-origin or curl/postman with no Origin
    if (!origin) return cb(null, true);

    // Exact allow-list
    if (exactOrigins.includes(origin)) return cb(null, true);

    // Local dev
    if (localOrigin && origin === localOrigin) return cb(null, true);

    // Vercel preview subdomains (e.g., https://my-branch-abc123.vercel.app)
    if (previewSuffix && origin.endsWith(previewSuffix)) return cb(null, true);

    // Block
    console.error(`🚨 CORS blocked: ${origin}`);
    return cb(new Error("Not allowed by CORS"));
  },
  credentials: false,
};

app.use(cors(corsOptions));
app.use(express.json());

// Health check
app.get("/healthz", (_req, res) => res.status(200).send("ok"));
app.get("/", (_req, res) => res.send("Backend is running ✅"));

// API
app.use("/api/evaluate-trades", evaluateTradesRoute);

// Global error handler (so CORS errors return JSON and 403)
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err?.message?.includes("CORS")) {
    return res.status(403).json({ error: "CORS blocked", details: err.message });
  }
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal Server Error" });
});

const PORT = Number(process.env.PORT) || 10000;
const NODE_ENV = process.env.NODE_ENV || "development";
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT} (env: ${NODE_ENV})`);
});
