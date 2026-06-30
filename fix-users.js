// fix-users.js
import "dotenv/config";
import mongoose from "mongoose";
import User from "./models/User.js";

async function fixOldUsers() {
  try {
    console.log("🔌 Connexion à la base de données...");

    // S'assurer que le fichier .env a bien été lu
    if (!process.env.MONGO_URI) {
      console.error("❌ ERREUR: MONGO_URI introuvable.");
      process.exit(1);
    }

    await mongoose.connect(process.env.MONGO_URI);
    console.log("🟢 Connecté à MongoDB!");

    // On cherche tous les utilisateurs qui :
    // 1. N'ont pas de compte externe lié (OAuth vide ou inexistant - ils se sont donc inscrits Classiquement)
    // 2. Ont le champ hasPassword différent de true
    const result = await User.updateMany(
      {
        $or: [
          { oauthProviders: { $exists: false } }, // Le champ n'existe pas encore
          { oauthProviders: { $size: 0 } }, // Ou le champ existe mais il est vide (aucun Google/FB)
        ],
        hasPassword: { $ne: true },
      },
      {
        $set: { hasPassword: true },
      },
    );

    console.log(`✅ Opération terminée avec succès !`);
    console.log(
      `🛠️ ${result.modifiedCount} ancien(s) utilisateur(s) standard corrigé(s).`,
    );
  } catch (error) {
    console.error("❌ Erreur lors de la mise à jour :", error);
  } finally {
    await mongoose.disconnect();
    console.log("👋 Déconnecté de la base de données.");
    process.exit(0);
  }
}

fixOldUsers();
