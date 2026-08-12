'use strict'

// Main-process startup must never depend on a generated cosmetic manifest.
// Updaters and older package layouts can omit root-level config files; keep the
// small runtime contract self-contained so branding can never crash the app.
const brand = Object.freeze({
  id: 'narra',
  displayName: 'Narra Studio',
  displayNameUpper: 'NARRA STUDIO',
  developer: Object.freeze({
    name: 'Local creator',
  }),
  assets: Object.freeze({
    appIcon: 'brand/narra-mark.svg',
  }),
  theme: Object.freeze({
    primary: '#8b5cff',
  }),
  features: Object.freeze({
    externalProviders: true,
  }),
})

function hexToRgb(hex) {
  const value = String(hex).replace(/^#/, '')
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ].join(',')
}

function brandText(value) {
  return String(value)
    .replace(/\{\{brandName\}\}/g, brand.displayName)
    .replace(/\{\{brandNameUpper\}\}/g, brand.displayNameUpper)
    .replace(/\{\{developerName\}\}/g, brand.developer.name)
}

module.exports = {
  brand,
  brandText,
  primaryRgb: hexToRgb(brand.theme.primary),
}
