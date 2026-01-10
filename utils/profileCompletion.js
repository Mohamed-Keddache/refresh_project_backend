export const calculateProfileCompletion = (candidate, user) => {
  const checks = {
    nom: !!user?.nom,
    telephone: !!candidate?.telephone,
    residence: !!candidate?.residence?.wilaya,

    bio: !!candidate?.bio,
    dateOfBirth: !!candidate?.dateOfBirth,
    gender: !!candidate?.gender,
    profilePicture: !!candidate?.profilePicture,

    desiredPosition: !!candidate?.desiredPosition,
    cv: candidate?.cvs?.length > 0,
    skills: candidate?.skills?.length > 0,
    experiences: candidate?.experiences?.length > 0,
    education: candidate?.education?.length > 0,
  };

  const completed = Object.values(checks).filter(Boolean).length;
  const total = Object.keys(checks).length;

  const minimumRequiredForApplication = {
    telephone: !!candidate?.telephone,
    residence: !!candidate?.residence?.wilaya,
    cv: candidate?.cvs?.length > 0,
    skills: candidate?.skills?.length > 0,
  };

  const canApply = Object.values(minimumRequiredForApplication).every(Boolean);
  const missingForApplication = Object.entries(minimumRequiredForApplication)
    .filter(([_, v]) => !v)
    .map(([k]) => {
      const labels = {
        telephone: "Numéro de téléphone",
        residence: "Localisation (wilaya)",
        cv: "CV",
        skills: "Au moins une compétence",
      };
      return labels[k] || k;
    });

  return {
    percentage: Math.round((completed / total) * 100),
    missing: Object.entries(checks)
      .filter(([_, v]) => !v)
      .map(([k]) => k),
    isComplete: completed === total,
    canApply,
    missingForApplication,
  };
};
