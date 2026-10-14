import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BrowserRouter, Navigate, Routes, Route } from "react-router-dom";
import Landing from "./pages/Landing";
import AuthGate from "./pages/AuthGate";
import Dashboard from "./pages/Dashboard";
import Create from "./pages/Create";
import Claim from "./pages/Claim";
import Activity from "./pages/Activity";
import Settings from "./pages/Settings";
import Studio from "./pages/Studio";
import StudioCampaign from "./pages/StudioCampaign";
import Inbox from "./pages/Inbox";
import CampaignLink from "./pages/CampaignLink";
import NotFound from "./pages/NotFound";
import { features } from "@/config/network";

/**
 * The legacy GiftLink MVP is switched off by default. When it is off its routes are not
 * registered at all, so they fall through to NotFound; only the Nomine surfaces remain.
 */
const legacyGiftLink = features.legacyGiftLink;

const App = () => (
  <TooltipProvider>
    <Toaster />
    <Sonner />
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/app" element={<AuthGate />} />
        <Route
          path="/dashboard"
          element={legacyGiftLink ? <Dashboard /> : <Navigate to="/inbox" replace />}
        />
        {legacyGiftLink && <Route path="/create" element={<Create />} />}
        {legacyGiftLink && <Route path="/claim/:id" element={<Claim />} />}
        {legacyGiftLink && <Route path="/activity" element={<Activity />} />}
        {legacyGiftLink && <Route path="/settings" element={<Settings />} />}
        <Route path="/studio" element={<Studio />} />
        <Route path="/studio/:campaignId" element={<StudioCampaign />} />
        <Route path="/inbox" element={<Inbox />} />
        <Route path="/campaign/:campaignId" element={<CampaignLink />} />
        {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  </TooltipProvider>
);

export default App;
