import { NavigationProvider } from "./NavigationContext";
import { ThemeProvider } from "./ThemeContext";

export default function App() {
  return (
    <ThemeProvider>
      <NavigationProvider />
    </ThemeProvider>
  );
}
