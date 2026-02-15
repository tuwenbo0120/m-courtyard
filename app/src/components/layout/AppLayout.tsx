import { useEffect, useRef } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Sidebar } from "./Sidebar";

export function AppLayout() {
  const mainRef = useRef<HTMLElement>(null);
  const { pathname } = useLocation();

  // Scroll main container to top on route change
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [pathname]);

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <Sidebar />
      <main id="app-main-scroll" ref={mainRef} className="flex-1 overflow-y-auto p-6">
        <Outlet />
      </main>
    </div>
  );
}
