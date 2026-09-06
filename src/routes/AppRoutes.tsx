import LegacyApp from '../LegacyApp';

export function AppRoutes() {
  // LegacyApp keeps the current hash-based navigation working while modules are extracted gradually.
  return <LegacyApp />;
}
