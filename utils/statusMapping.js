// Mapping recruteur → candidat
export const RECRUITER_TO_CANDIDATE_STATUS = {
  nouvelle: "envoyee",
  consultee: "en_cours",
  preselection: "en_cours",
  en_discussion: "en_cours",
  entretien_planifie: "entretien",
  entretien_termine: "en_cours",
  pending_feedback: "en_cours",
  shortlisted: "en_cours", // Le candidat ne sait pas qu'il est shortlisté
  retenue: "retenue",
  embauche: "embauchee",
  offer_declined: "en_cours", // On ne veut pas que le candidat voie "refusé"
  refusee: "non_retenue",
};

export const mapRecruiterToCandidate = (recruiterStatus) => {
  return RECRUITER_TO_CANDIDATE_STATUS[recruiterStatus] || "en_cours";
};

// Statuts qui déclenchent une notification au candidat
export const NOTIFY_CANDIDATE_STATUSES = ["retenue", "refusee", "embauche"];

// Statuts terminaux
export const TERMINAL_STATUSES = {
  candidate: ["embauchee", "non_retenue", "retiree"],
  recruiter: ["embauche", "refusee", "offer_declined"],
};

// Messages pré-définis pour le premier contact (Phase 1)
export const PREDEFINED_MESSAGES = {
  greeting: {
    id: "greeting",
    template: (candidateName, offerTitle) =>
      `Bonjour ${candidateName}, votre profil a retenu notre attention pour le poste de ${offerTitle}. Êtes-vous disponible pour échanger ?`,
  },
  availability: {
    id: "availability",
    template: (candidateName, offerTitle) =>
      `Bonjour ${candidateName}, nous examinons les candidatures pour ${offerTitle}. Pouvez-vous nous confirmer votre disponibilité actuelle ?`,
  },
  interest: {
    id: "interest",
    template: (candidateName, offerTitle) =>
      `Bonjour ${candidateName}, nous avons une opportunité intéressante pour le poste de ${offerTitle}. Seriez-vous intéressé(e) pour en discuter ?`,
  },
  quick_chat: {
    id: "quick_chat",
    template: (candidateName, offerTitle) =>
      `Bonjour ${candidateName}, votre candidature pour ${offerTitle} nous intéresse. Pouvons-nous organiser un court échange pour en savoir plus sur votre parcours ?`,
  },
};

// Message pré-défini pour l'entretien sans conversation préalable
export const INTERVIEW_INIT_MESSAGE = {
  template: (candidateName) =>
    `Bonjour ${candidateName}, nous avons examiné votre profil et souhaitons vous proposer un entretien. Veuillez consulter la proposition ci-dessous.`,
};
