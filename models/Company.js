import mongoose from "mongoose";

const companySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true },
    logo: { type: String },
    website: { type: String },
    description: { type: String },
    industry: { type: String },
    location: { type: String },
    size: { type: String },

    status: {
      type: String,
      enum: ["pending", "active", "rejected"],
      default: "pending",
    },
  },
  { timestamps: true }
);
companySchema.index({ status: 1 });
companySchema.index({ name: "text" });
export default mongoose.model("Company", companySchema);
