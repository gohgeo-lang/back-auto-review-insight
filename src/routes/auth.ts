import { Router } from "express";
import { signup, login, setStoreUrl } from "../controllers/authController";
const router = Router();

router.post("/set-store", setStoreUrl);
router.post("/signup", signup);
router.post("/login", login);

export default router;
