// utils/statusMapping.js

export const RECRUITER_TO_CANDIDATE_STATUS = {
  nouvelle: "envoyee",
  consultee: "en_cours",
  preselection: "en_cours",
  en_discussion: "en_cours",
  entretien_planifie: "en_cours",
  entretien_termine: "en_cours",
  retenue: "retenue",
  refusee: "non_retenue",
};

export const mapRecruiterToCandidate = (recruiterStatus) => {
  return RECRUITER_TO_CANDIDATE_STATUS[recruiterStatus] || "en_cours";
};

// Statuts qui déclenchent une notification au candidat
export const NOTIFY_CANDIDATE_STATUSES = ["retenue", "refusee"];

// Statuts terminaux (pas de retour possible)
export const TERMINAL_STATUSES = {
  candidate: ["retenue", "non_retenue", "retiree"],
  recruiter: ["retenue", "refusee"],
};
