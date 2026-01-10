import mongoose from "mongoose";

const supportTicketSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    subject: { type: String, required: true },
    description: { type: String, required: true },
    category: {
      type: String,
      enum: [
        "support_understanding",
        "technical_issue",
        "account_profile",
        "company_recruitment",
        "documents_verification",
        "special_request",
        "feedback_suggestion",
      ],
      required: true,
    },
    assignedToLabel: {
      type: String,
      enum: [
        "support",
        "technical",
        "operational",
        "recruitment",
        "moderation",
        "super_admin",
        "product",
      ],
    },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "Admin" },
    status: {
      type: String,
      enum: ["open", "in_progress", "awaiting_user", "resolved", "closed"],
      default: "open",
    },
    priority: {
      type: String,
      enum: ["low", "medium", "high", "urgent"],
      default: "medium",
    },
    attachments: [{ type: String }],
    messages: [
      {
        from: { type: String, enum: ["user", "admin"], required: true },
        content: { type: String, required: true },
        adminId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        attachments: [String],
        createdAt: { type: Date, default: Date.now },
      },
    ],
    chatEnabled: { type: Boolean, default: false },
    resolvedAt: Date,
    closedAt: Date,
  },
  { timestamps: true }
);

supportTicketSchema.pre("save", function (next) {
  if (this.isNew && !this.assignedToLabel) {
    const categoryToLabel = {
      support_understanding: "support",
      technical_issue: "technical",
      account_profile: "operational",
      company_recruitment: "recruitment",
      documents_verification: "moderation",
      special_request: "super_admin",
      feedback_suggestion: "product",
    };
    this.assignedToLabel = categoryToLabel[this.category] || "support";
  }
  next();
});

supportTicketSchema.index({ status: 1, createdAt: -1 });
supportTicketSchema.index({ assignedToLabel: 1, status: 1 });

export default mongoose.model("SupportTicket", supportTicketSchema);
