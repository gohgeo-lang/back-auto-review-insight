import "./crawler/scheduler";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

import { authMiddleware } from "./middleware/authMiddleware";

import crawlerRoutes from "./routes/crawler";
import summaryRoutes from "./routes/summary";
import replyRoutes from "./routes/reply";
import insightRoutes from "./routes/insight";
import authRoutes from "./routes/auth";
import reviewRoutes from "./routes/review";
import aiRoutes from "./routes/ai";
import storeRoutes from "./routes/store";

const app = express();

app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    credentials: true,
  })
);

app.use(express.json());

// 보호 필요 X
app.use("/auth", authRoutes);
app.use("/crawler", crawlerRoutes);

// 보호 필요 O
app.use("/summary", authMiddleware, summaryRoutes);
app.use("/reply", authMiddleware, replyRoutes);
app.use("/insight", authMiddleware, insightRoutes);
app.use("/reviews", authMiddleware, reviewRoutes);
app.use("/ai", authMiddleware, aiRoutes);
app.use("/store", authMiddleware, storeRoutes);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log("Server running on port", PORT));
