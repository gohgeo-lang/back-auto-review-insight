import "./crawler/scheduler";
import crawlerRoutes from "./routes/crawler";
import express, { application } from "express";
import cors from "cors";
import dotenv from "dotenv";
import summaryRoutes from "./routes/summary";
import "./crawler/scheduler";
import replyRoutes from "./routes/reply";
import insightRoutes from "./routes/insight";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use("/crawler", crawlerRoutes);
app.use("/summary", summaryRoutes);
app.use("/reply", replyRoutes);
app.use("/insight", insightRoutes);

import authRoutes from "./routes/auth";
import reviewRoutes from "./routes/review";
import aiRoutes from "./routes/ai";

app.use("/auth", authRoutes);
app.use("/reviews", reviewRoutes);
app.use("/ai", aiRoutes);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log("Server running on port", PORT));
