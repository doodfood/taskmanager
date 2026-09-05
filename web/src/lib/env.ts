/**
 * True unless the app was built with NEXT_PUBLIC_APP_ENV=production.
 *
 * Gates every dev-tool behaviour: rendering the clock-spoofer / reset panels
 * and calling the /api/debug/* endpoints (which are not mounted in production,
 * so calling them there would 404). NEXT_PUBLIC_* vars are inlined at build
 * time, so in a production build this is a compile-time `false` and the
 * dev-only code paths are tree-shaken away.
 */
export const SHOW_DEV_TOOLS = process.env.NEXT_PUBLIC_APP_ENV !== 'production';
