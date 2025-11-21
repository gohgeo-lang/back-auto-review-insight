import { Request, Response } from "express";
import { prisma } from "../lib/prisma";

export const saveReply = async (req: Request, res: Response) => {
  try {
    const { reviewId, content, tone } = req.body;
    const userId = (req as any).user.id;

    if (!reviewId || !content)
      return res.status(400).json({ error: "reviewId, content 필요" });

    const reply = await prisma.reply.upsert({
      where: { reviewId },
      update: { content, tone },
      create: { reviewId, content, tone },
    });

    res.json(reply);
  } catch (error) {
    console.error("saveReply Error:", error);
    return res.status(500).json({ error: "FAILED_TO_SAVE_REPLY" });
  }
};

export const getReply = async (req: Request, res: Response) => {
  try {
    const { reviewId } = req.params;
    const userId = (req as any).user.id;

    const reply = await prisma.reply.findFirst({
      where: {
        reviewId,
        review: { userId },
      },
    });

    if (!reply) {
      return res.status(404).json({ error: "REPLY_NOT_FOUND" });
    }
    return res.json(reply);
  } catch (error) {
    console.error("getReply Error:", error);
    return res.status(500).json({ error: "FAILED_TO_GET_REPLY" });
  }
};
