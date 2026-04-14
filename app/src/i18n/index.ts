import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import enCommon from "./locales/en/common.json";
import enProject from "./locales/en/project.json";
import enNav from "./locales/en/nav.json";
import enTraining from "./locales/en/training.json";
import enDataPrep from "./locales/en/dataPrep.json";
import enSettings from "./locales/en/settings.json";
import enTesting from "./locales/en/testing.json";
import enExport from "./locales/en/export.json";
import enNotification from "./locales/en/notification.json";
import zhCommon from "./locales/zh-CN/common.json";
import zhProject from "./locales/zh-CN/project.json";
import zhNav from "./locales/zh-CN/nav.json";
import zhTraining from "./locales/zh-CN/training.json";
import zhDataPrep from "./locales/zh-CN/dataPrep.json";
import zhSettings from "./locales/zh-CN/settings.json";
import zhTesting from "./locales/zh-CN/testing.json";
import zhExport from "./locales/zh-CN/export.json";
import zhNotification from "./locales/zh-CN/notification.json";

const resources = {
  en: {
    common: enCommon,
    project: enProject,
    nav: enNav,
    training: enTraining,
    dataPrep: enDataPrep,
    settings: enSettings,
    testing: enTesting,
    export: enExport,
    notification: enNotification,
  },
  "zh-CN": {
    common: zhCommon,
    project: zhProject,
    nav: zhNav,
    training: zhTraining,
    dataPrep: zhDataPrep,
    settings: zhSettings,
    testing: zhTesting,
    export: zhExport,
    notification: zhNotification,
  },
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: "en",
    defaultNS: "common",
    ns: [
      "common",
      "project",
      "nav",
      "training",
      "dataPrep",
      "settings",
      "testing",
      "export",
      "notification",
    ],
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ["localStorage", "navigator"],
      caches: ["localStorage"],
    },
  });

export default i18n;
