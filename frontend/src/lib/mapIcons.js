// src/lib/mapIcons.js
const ICON_BASE = "/assets/map-icons"; // adjust if your build serves assets differently

export const ICON_BY_TYPE = {
  CHIME: `${ICON_BASE}/CHIME.svg`,
  ALZ: `${ICON_BASE}/ALZ.svg`,
  WA: `${ICON_BASE}/WA.svg`,
  NCBI: `${ICON_BASE}/NCBI.svg`,
  PHA: `${ICON_BASE}/PHA.svg`,
  NURSE: `${ICON_BASE}/NURSE.svg`,
  MOW: `${ICON_BASE}/MOW.svg`,
  MABS: `${ICON_BASE}/MABS.svg`,
  HOSP: `${ICON_BASE}/HOSP.svg`,
  HSE: `${ICON_BASE}/HSE.svg`,
  PCARE: `${ICON_BASE}/PCARE.svg`,
  "24hr-Garda": `${ICON_BASE}/24hr-Garda.svg`,
  Garda: `${ICON_BASE}/Garda.svg`,
  coco: `${ICON_BASE}/coco.svg`,
  cyco: `${ICON_BASE}/cyco.svg`,
  regco: `${ICON_BASE}/regco.svg`,
};

export function getIconUrl(type) {
  return ICON_BY_TYPE[type] || `${ICON_BASE}/default.svg`; // optional fallback
}
