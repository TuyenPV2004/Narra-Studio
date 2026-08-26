import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { messages, type AppMessages, type Locale } from "@/i18n/messages";
import { storageKeys } from "@/storage/keys";
import { readStorageValue, writeStorageValue } from "@/storage/safe-storage";

interface LocaleContextValue {
  locale: Locale;
  messages: AppMessages;
  setLocale: (locale: Locale) => void;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);
const resolveInitialLocale = (): Locale =>
  readStorageValue(storageKeys.locale) === "en" ? "en" : "vi";

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(resolveInitialLocale);

  useEffect(() => {
    document.documentElement.lang = locale;
    writeStorageValue(storageKeys.locale, locale);
  }, [locale]);

  const value = useMemo(
    () => ({ locale, messages: messages[locale], setLocale }),
    [locale],
  );
  return (
    <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
  );
}

export function useLocale(): LocaleContextValue {
  const context = useContext(LocaleContext);
  if (!context)
    throw new Error("useLocale must be used inside LocaleProvider.");
  return context;
}
