'use strict'

// Main-process startup must never depend on a generated cosmetic manifest.
// Updaters and older package layouts can omit root-level config files; keep the
// small runtime contract self-contained so branding can never crash the app.
const brand = Object.freeze({
  id: 'narra',
  displayName: 'Narra Studio',
  displayNameUpper: 'Narra Studio',
  developer: Object.freeze({
    name: 'Local creator',
  }),
  assets: Object.freeze({
    appIcon: 'brand/narra-mark.svg',
  }),
  theme: Object.freeze({
    primary: '#7c3aed',
    primaryHover: '#6d28d9',
    primarySoft: '#ede9fe',
    onPrimary: '#ffffff',
    background0: '#f8f7fc',
    background1: '#ffffff',
    background2: '#f3f0f8',
    background3: '#ebe7f2',
    background4: '#ded8e8',
    backgroundHover: '#f0ebf8',
    border: '#d8d1e2',
    borderSubtle: '#e8e3ee',
    text: '#211a2b',
    textSecondary: '#51465f',
    textMuted: '#71667e',
    textQuiet: '#776c82',
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
