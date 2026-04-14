import { useTranslation } from "react-i18next";
import logoImg from "@/assets/logo.png";
import { useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  FolderOpen,
  Database,
  Cpu,
  MessageSquare,
  Upload,
  Settings,
  Languages,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { useProjectStore } from "@/stores/projectStore";

export function Sidebar() {
  const { t, i18n } = useTranslation("nav");
  const location = useLocation();
  const navigate = useNavigate();
  const { currentProject, projects } = useProjectStore();

  const hasProject = !!currentProject;
  const projectSubPaths = ["/data-prep", "/training", "/testing", "/export"];
  const isInProjectSection =
    projectSubPaths.includes(location.pathname) ||
    location.pathname === "/projects";

  const toggleLanguage = () => {
    const next = i18n.language === "zh-CN" ? "en" : "zh-CN";
    i18n.changeLanguage(next);
  };

  const subNavItems = [
    { key: "dataPrep", icon: <Database size={16} />, path: "/data-prep" },
    { key: "training", icon: <Cpu size={16} />, path: "/training" },
    { key: "testing", icon: <MessageSquare size={16} />, path: "/testing" },
    { key: "export", icon: <Upload size={16} />, path: "/export" },
  ];

  return (
    <aside className="flex h-screen w-56 flex-col border-r border-border bg-sidebar-background">
      {/* Logo */}
      <div className="flex h-14 items-center gap-2 border-b border-border px-4">
        <img src={logoImg} alt="M-Courtyard" className="h-8 w-8 rounded-lg" />
        <span className="text-sm font-semibold text-sidebar-foreground">
          M-Courtyard
        </span>
      </div>

      <nav className="flex-1 space-y-1.5 overflow-y-auto p-3">
        {/* Dashboard - top level */}
        <button
          onClick={() => navigate("/")}
          className={`group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all ${
            location.pathname === "/"
              ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-sm"
              : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
          }`}
        >
          <LayoutDashboard
            size={18}
            className={
              location.pathname === "/"
                ? "text-primary"
                : "text-muted-foreground group-hover:text-foreground"
            }
          />
          <span>{t("dashboard")}</span>
        </button>

        {/* Projects - top level with expandable sub-nav */}
        <div className="pt-1">
          <button
            onClick={() => navigate("/projects")}
            className={`group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all ${
              isInProjectSection
                ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-sm"
                : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
            }`}
          >
            <FolderOpen
              size={18}
              className={
                isInProjectSection
                  ? "text-primary"
                  : "text-muted-foreground group-hover:text-foreground"
              }
            />
            <span className="flex-1 text-left">{t("projects")}</span>
            {projects.length > 0 &&
              (isInProjectSection ? (
                <ChevronDown size={14} className="text-muted-foreground/70" />
              ) : (
                <ChevronRight size={14} className="text-muted-foreground/70" />
              ))}
          </button>

          {/* Current project indicator */}
          {currentProject && isInProjectSection && (
            <div className="mx-3 mt-2 mb-2 truncate rounded-md border border-primary/20 bg-primary/5 px-2.5 py-1.5 text-[11px] font-medium text-primary shadow-sm">
              {currentProject.name}
            </div>
          )}

          {/* Sub-navigation items */}
          {isInProjectSection && (
            <div className="mt-1 space-y-0.5 pl-3 border-l border-border/50 ml-5">
              {subNavItems.map((item) => {
                const isActive = location.pathname === item.path;
                const isDisabled = !hasProject;
                return (
                  <button
                    key={item.key}
                    onClick={() => {
                      if (!isDisabled) navigate(item.path);
                    }}
                    disabled={isDisabled}
                    className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-all ${
                      isDisabled
                        ? "cursor-not-allowed opacity-40 grayscale"
                        : isActive
                          ? "bg-primary/10 text-primary"
                          : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                    }`}
                  >
                    {item.icon}
                    <span>{t(item.key)}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </nav>

      {/* Bottom */}
      <div className="space-y-1 border-t border-border p-2">
        <button
          onClick={toggleLanguage}
          className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        >
          <Languages size={20} />
          <span>{i18n.language === "zh-CN" ? "English" : "中文"}</span>
        </button>
        <button
          onClick={() =>
            navigate("/settings", { state: { from: location.pathname } })
          }
          className={`flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors ${
            location.pathname === "/settings"
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          }`}
        >
          <Settings size={20} />
          <span>{t("settings")}</span>
        </button>
      </div>
    </aside>
  );
}
