import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import dotenv from "dotenv";
import evaluateTradesRoute from "./evaluatetrades";

dotenv.config();

const app = express();

// -------------------- CONFIG --------------------
const PORT = process.env.PORT || 5000;

// Allow multiple origins (local + deployed frontend)
const allowedOrigins = [
  "http://localhost:3000",
  process.env.FRONTEND_URL || "" // e.g., "https://yourfrontend.com"
].filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS blocked: ${origin}`));
      }
    },
    credentials: true,
  })
);

app.use(express.json());

// -------------------- ROUTES --------------------
app.use("/api/evaluate-trades", evaluateTradesRoute);

app.get("/", (_req: Request, res: Response) =>
  res.send("Backend is running ✅")
);

// -------------------- ERROR HANDLER --------------------
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error("🚨 Server Error:", err.message || err);
  res.status(500).json({ error: "Internal server error" });
});

// -------------------- START SERVER --------------------
app.listen(PORT, () =>
  console.log(`🚀 Server running on port ${PORT} (env: ${process.env.NODE_ENV || "dev"})`)
);
