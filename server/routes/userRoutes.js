import express from "express";
import { auth } from "../middlewares/auth.js";
import { getPublishedCreations, getUserCreations } from "../controllers/userController.js";

const userRouter = express.Router();
userRouter.get('/get-user-creations', auth, getUserCreations);
userRouter.get('/get-published-creations', auth, getPublishedCreations);

export default userRouter