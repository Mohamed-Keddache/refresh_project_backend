import express from "express";
import auth from "../middleware/auth.js";
import { validators } from "../middleware/validate.js";
import { uploadRateLimiter } from "../middleware/security.js";
import * as supportController from "../controllers/supportController.js";
import { uploadAttachments, handleMulterError } from "../config/multer.js";

const router = express.Router();

router.use(auth);

router.post(
  "/tickets",
  uploadRateLimiter,
  uploadAttachments.array("attachments", 5),
  handleMulterError,
  validators.createTicket,
  supportController.createTicket,
);

router.get("/tickets", supportController.getMyTickets);

router.get(
  "/tickets/:ticketId",
  validators.mongoId("ticketId"),
  supportController.getTicketDetails,
);

router.post(
  "/tickets/:ticketId/reply",
  uploadRateLimiter,
  uploadAttachments.array("attachments", 3),
  handleMulterError,
  validators.mongoId("ticketId"),
  validators.replyToTicket,
  supportController.replyToTicket,
);

export default router;
