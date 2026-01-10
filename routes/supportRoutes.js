import express from "express";
import auth from "../middleware/auth.js";
import * as supportController from "../controllers/supportController.js";
import { uploadAttachments } from "../config/multer.js";

const router = express.Router();

router.use(auth);

router.post(
  "/tickets",
  uploadAttachments.array("attachments", 5),
  supportController.createTicket
);
router.get("/tickets", supportController.getMyTickets);
router.get("/tickets/:ticketId", supportController.getTicketDetails);
router.post(
  "/tickets/:ticketId/reply",
  uploadAttachments.array("attachments", 3),
  supportController.replyToTicket
);

export default router;
