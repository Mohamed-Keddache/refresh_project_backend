import bcrypt from "bcryptjs";
import User from "../models/User.js";
import Admin from "../models/Admin.js";

export const seedAdmin = async () => {
  try {
    const exist = await User.findOne({ role: "admin" });
    if (exist) {
      console.log("👑 Admin déjà existant.");
      return;
    }

    // Fix - use environment variable with strong fallback warning:
    const adminPassword = process.env.ADMIN_DEFAULT_PASSWORD;
    if (!adminPassword) {
      console.error(
        "❌ ADMIN_DEFAULT_PASSWORD not set in environment. Skipping admin seed for security.",
      );
      return;
    }
    const hash = await bcrypt.hash(adminPassword, 12);

    const user = await User.create({
      nom: "Super Admin",
      email: "admin@recrutement.com",
      motDePasse: hash,
      role: "admin",
      emailVerified: true,
      accountStatus: "active",
    });

    await Admin.create({
      userId: user._id,
      label: "super_admin",
      status: "active",
      permissions: {
        createAdmin: true,
        deleteAdmin: true,
        editAdminPermissions: true,
        assignAdminLabels: true,
        validateOffers: true,
        validateRecruiters: true,
        validateCompanies: true,
        banUsers: true,
        suspendUsers: true,
        proposeCandidates: true,
        manageAnnouncements: true,
        sendNotifications: true,
        handleSupportTickets: true,
        viewStats: true,
        viewLogs: true,
      },
    });

    console.log("✅ Super Admin créé avec toutes les permissions");
  } catch (err) {
    console.error("❌ Erreur création admin:", err.message);
  }
};
