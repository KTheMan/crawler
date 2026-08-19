import freeCadNutIconsUrl from "../dev-themes/FreeCAD_Nut_Icons.fctheme?url";
import misterMakerGrayBlueYellowUrl from "../dev-themes/MM_Gray_blue_yellow.zip?url";

export interface BundledDevelopmentTheme {
  id: string;
  name: string;
  filename: string;
  url: string;
  default?: boolean;
}

/** This module is dynamically imported only in explicitly development builds. */
export const bundledDevelopmentThemes: readonly BundledDevelopmentTheme[] = [
  {
    id: "freecad-nut-icons",
    name: "FreeCAD Nut Icons",
    filename: "FreeCAD_Nut_Icons.fctheme",
    url: freeCadNutIconsUrl,
    default: true,
  },
  {
    id: "mm-gray-blue-yellow",
    name: "MM Gray / Blue / Yellow",
    filename: "MM_Gray_blue_yellow.zip",
    url: misterMakerGrayBlueYellowUrl,
  },
] as const;

export const defaultDevelopmentTheme = bundledDevelopmentThemes.find((theme) => theme.default)!;
