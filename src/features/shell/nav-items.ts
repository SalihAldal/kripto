import type { TranslationKey } from "@/src/i18n/messages";

type ShellNavItem = {
  href: string;
  key: TranslationKey;
};

export const shellNavItems: ShellNavItem[] = [
  { href: "/dashboard", key: "nav.dashboard" },
  { href: "/market-watch", key: "nav.liveTrading" },
  { href: "/simulation-lab", key: "nav.simulationLab" },
  { href: "/ai-analysis", key: "nav.aiAnalysis" },
  { href: "/trade-history", key: "nav.tradeHistory" },
  { href: "/pnl-report", key: "nav.pnlReport" },
  { href: "/strategy-settings", key: "nav.strategySettings" },
  { href: "/risk-management", key: "nav.riskManagement" },
  { href: "/logs", key: "nav.logs" },
  { href: "/profile-security", key: "nav.profileSecurity" },
  { href: "/system-command", key: "nav.systemCommand" },
];
