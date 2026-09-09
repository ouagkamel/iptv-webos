// src/media/DualPlayerPolicy.js — spec §7.5 (verbatim).
// Triple porte : modèle allowlist + webOS ≥ 6 (SDK, jamais l'UA) + abonnement ≥ 2 flux.
// Branchement Xtream V9 : provider.maxConcurrentStreams ← ACCOUNT_INFO.maxConnections
// (§6.5) — câblé dans app.js ; absent/< 2 → porte fermée (comportement sûr).
export const DualPlayerPolicy = {
  // Allowlist laboratoire : préfixes modelName validés physiquement (deviceInfo.modelName)
  ALLOWED_MODELS: ['OLED65G2', 'OLED77G2', 'QNED99', 'QNED91'],

  HOVER_DELAY_MS: 800, // focus immobile minimal avant activation du second player

  /**
   * capabilities : rapport de CapabilityDetector (§3) — webosVersion issue du SDK, pas de l'UA
   * provider      : { maxConcurrentStreams } fourni par l'abonnement
   */
  isEligible(capabilities, provider) {
    if (!capabilities || !capabilities.isWebOS6OrHigher) return false;
    if (!provider || provider.maxConcurrentStreams < 2) return false;
    const model = capabilities.modelName || '';
    for (let i = 0; i < this.ALLOWED_MODELS.length; i++) {
      if (model.indexOf(this.ALLOWED_MODELS[i]) === 0) return true;
    }
    return false;
  },

  shouldActivate(focusStillMs) {
    return focusStillMs >= this.HOVER_DELAY_MS;
  }
};
