import type { z } from "zod";
import type { Registry, registryItemTypeSchema } from "../registry/schema";
// @sts-nocheck
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { template } from "lodash-es";
import { rimraf } from "rimraf";
import { registry } from "../registry";
import { buildRegistry as crawlContent } from "./crawl-content";
import { baseColors } from "../registry/registry-base-colors";
import { colorMapping, colors } from "../registry/registry-colors";
import { registryEntrySchema, registrySchema } from "../registry/schema";

const REGISTRY_PATH = path.join(process.cwd(), "public/r");

const REGISTRY_INDEX_WHITELIST: z.infer<typeof registryItemTypeSchema>[] = [
  "registry:ui",
  "registry:block",
  "registry:example",
  "registry:hook",
];

// ----------------------------------------------------------------------------
// Build __registry__/index.ts.
// ----------------------------------------------------------------------------
async function buildRegistry(registry: Registry) {
  let index = `// @ts-nocheck
// This file is autogenerated by scripts/build-registry.ts
// Do not edit this file directly.

export const Index: Record<string, any> = {`;

  // Build index
  for (const item of registry) {
    const resolveFiles = item.files?.map(
      (file) => `components/content/inspira/${typeof file === "string" ? file : file.path}`,
    );
    if (!resolveFiles) {
      continue;
    }

    const type = item.type.split(":")[1];
    const sourceFilename = "";

    let componentPath = `@/components/content/inspira/${type}/${item.name}`;

    if (item.files) {
      if (item.files?.length) {
        componentPath = `@/components/content/inspira/${item.files[0].path}`;
      }
    }

    index += `
  "${item.name}": {
    name: "${item.name}",
    description: "${item.description ?? ""}",
    type: "${item.type}",
    registryDependencies: ${JSON.stringify(item.registryDependencies)},
    files: [${item.files?.map((file) => {
      const filePath = `components/content/inspira/${typeof file === "string" ? file : file.path}`;
      const resolvedFilePath = path.resolve(filePath);
      return typeof file === "string"
        ? `"${resolvedFilePath}"`
        : `{
      path: "${filePath}",
      type: "${file.type}",
      target: "${file.target ?? ""}"
    }`;
    })}],
    component: () => import("${componentPath}").then((m) => m.default),
    source: "${sourceFilename}",
    category: "${item.category ?? ""}",
    subcategory: "${item.subcategory ?? ""}"
  },`;
  }

  index += `
}
`;

  // ----------------------------------------------------------------------------
  // Build registry/index.json.
  // ----------------------------------------------------------------------------
  const items = registry
    .filter((item) => ["registry:ui"].includes(item.type))
    .map((item) => {
      return {
        ...item,
        files: item.files?.map((_file) => {
          const file = { path: _file.path, type: item.type };
          return file;
        }),
      };
    });
  const registryJson = JSON.stringify(items, null, 2);
  rimraf.sync(path.join(REGISTRY_PATH, "index.json"));
  await writeFile(path.join(REGISTRY_PATH, "index.json"), registryJson);

  // Write style index.
  rimraf.sync(path.join(process.cwd(), "__registry__/index.ts"));
  await writeFile(path.join(process.cwd(), "__registry__/index.ts"), index);
}

// ----------------------------------------------------------------------------
// Build __registry__/block.ts.
// ----------------------------------------------------------------------------
async function buildBlockRegistry(registry: Registry) {
  let index = `// @ts-nocheck
// This file is autogenerated by scripts/build-registry.ts
// Do not edit this file directly.
export const Index: Record<string, any> = {`;

  // Build style index.
  for (const item of registry) {
    if (item.type !== "registry:block") continue;

    const resolveFiles = item.files?.map(
      (file) => `components/content/inspira/${typeof file === "string" ? file : file.path}`,
    );
    if (!resolveFiles) {
      continue;
    }

    const type = item.type.split(":")[1];

    let componentPath = `@/components/content/inspira/${type}/${item.name}`;

    if (item.files) {
      if (item.files?.length) {
        componentPath = `@/components/content/inspira/${item.files[0].path}`;
      }
    }

    index += `
  "${item.name}": {
    name: "${item.name}",
    description: "${item.description ?? ""}",
    type: "${item.type}",
    registryDependencies: ${JSON.stringify(item.registryDependencies)},
    files: [${item.files?.map((file) => {
      const filePath = `components/content/inspira/${typeof file === "string" ? file : file.path}`;
      const resolvedFilePath = path.resolve(filePath);
      return typeof file === "string"
        ? `"${resolvedFilePath}"`
        : `{
      path: "${filePath}",
      type: "${file.type}",
      target: "${file.target ?? ""}",
      raw: () => import("@/${filePath}?raw").then((m) => m.default)
    }`;
    })}],
    component: () => import("${componentPath}").then((m) => m.default),
    raw: () => import("${componentPath}?raw").then((m) => m.default),
    source: "",
    category: "${item.category ?? ""}",
    subcategory: "${item.subcategory ?? ""}"
  },`;
  }

  index += `
}
`;

  // Write style block.
  rimraf.sync(path.join(process.cwd(), "__registry__/block.ts"));
  await writeFile(path.join(process.cwd(), "__registry__/block.ts"), index);
}

// ----------------------------------------------------------------------------
// Build registry/styles/[style]/[name].json.
// ----------------------------------------------------------------------------
async function buildStyles(registry: Registry) {
  const targetPath = path.join(REGISTRY_PATH, "styles");

  // Create directory if it doesn't exist.
  if (!existsSync(targetPath)) {
    await fs.mkdir(targetPath, { recursive: true });
  }

  for (const item of registry) {
    if (!REGISTRY_INDEX_WHITELIST.includes(item.type)) continue;

    let files;
    if (item.files) {
      files = await Promise.all(
        item.files.map(async (_file) => {
          const file = {
            path: _file.path,
            type: _file.type,
            content: "",
            target: _file.target ?? "",
          };

          let content: string;
          try {
            if (file.type === "registry:hook") {
              content = await fs.readFile(path.join(process.cwd(), file.path), "utf8");
            } else {
              content = await fs.readFile(
                path.join(process.cwd(), "components", "content", "inspira", file.path),
                "utf8",
              );
            }
          } catch (error) {
            console.error(error);
            return;
          }

          const target = file.target || "";

          return {
            path: file.path,
            type: file.type,
            content,
            target,
          };
        }),
      );
    }

    const payload = registryEntrySchema
      .omit({
        category: true,
        subcategory: true,
      })
      .safeParse({
        ...item,
        files,
      });

    if (payload.success) {
      await writeFile(
        path.join(targetPath, `${item.name}.json`),
        JSON.stringify(payload.data, null, 2),
      );
    }
  }
}

// ----------------------------------------------------------------------------
// Build registry/colors/index.json.
// ----------------------------------------------------------------------------
async function buildThemes() {
  const colorsTargetPath = path.join(REGISTRY_PATH, "colors");
  rimraf.sync(colorsTargetPath);
  if (!existsSync(colorsTargetPath)) {
    await fs.mkdir(colorsTargetPath, { recursive: true });
  }

  const colorsData: Record<string, any> = {};
  for (const [color, value] of Object.entries(colors)) {
    if (typeof value === "string") {
      colorsData[color] = value;
      continue;
    }

    if (Array.isArray(value)) {
      colorsData[color] = value.map((item) => ({
        ...item,
        rgbChannel: item.rgb.replace(/^rgb\((\d+),(\d+),(\d+)\)$/, "$1 $2 $3"),
        hslChannel: item.hsl.replace(/^hsl\(([\d.]+),([\d.]+%),([\d.]+%)\)$/, "$1 $2 $3"),
      }));
      continue;
    }

    if (typeof value === "object") {
      colorsData[color] = {
        ...value,
        rgbChannel: value.rgb.replace(/^rgb\((\d+),(\d+),(\d+)\)$/, "$1 $2 $3"),
        hslChannel: value.hsl.replace(/^hsl\(([\d.]+),([\d.]+%),([\d.]+%)\)$/, "$1 $2 $3"),
      };
      continue;
    }
  }

  await writeFile(path.join(colorsTargetPath, "index.json"), JSON.stringify(colorsData, null, 2));

  // ----------------------------------------------------------------------------
  // Build registry/colors/[base].json.
  // ----------------------------------------------------------------------------
  const BASE_STYLES = `@tailwind base;
@tailwind components;
@tailwind utilities;
  `;

  const BASE_STYLES_WITH_VARIABLES = `@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --background: <%- colors.light["background"] %>;
    --foreground: <%- colors.light["foreground"] %>;
    --card: <%- colors.light["card"] %>;
    --card-foreground: <%- colors.light["card-foreground"] %>;
    --popover: <%- colors.light["popover"] %>;
    --popover-foreground: <%- colors.light["popover-foreground"] %>;
    --primary: <%- colors.light["primary"] %>;
    --primary-foreground: <%- colors.light["primary-foreground"] %>;
    --secondary: <%- colors.light["secondary"] %>;
    --secondary-foreground: <%- colors.light["secondary-foreground"] %>;
    --muted: <%- colors.light["muted"] %>;
    --muted-foreground: <%- colors.light["muted-foreground"] %>;
    --accent: <%- colors.light["accent"] %>;
    --accent-foreground: <%- colors.light["accent-foreground"] %>;
    --destructive: <%- colors.light["destructive"] %>;
    --destructive-foreground: <%- colors.light["destructive-foreground"] %>;
    --border: <%- colors.light["border"] %>;
    --input: <%- colors.light["input"] %>;
    --ring: <%- colors.light["ring"] %>;
    --radius: 0.5rem;
    --chart-1: <%- colors.light["chart-1"] %>;
    --chart-2: <%- colors.light["chart-2"] %>;
    --chart-3: <%- colors.light["chart-3"] %>;
    --chart-4: <%- colors.light["chart-4"] %>;
    --chart-5: <%- colors.light["chart-5"] %>;
  }

  .dark {
    --background: <%- colors.dark["background"] %>;
    --foreground: <%- colors.dark["foreground"] %>;
    --card: <%- colors.dark["card"] %>;
    --card-foreground: <%- colors.dark["card-foreground"] %>;
    --popover: <%- colors.dark["popover"] %>;
    --popover-foreground: <%- colors.dark["popover-foreground"] %>;
    --primary: <%- colors.dark["primary"] %>;
    --primary-foreground: <%- colors.dark["primary-foreground"] %>;
    --secondary: <%- colors.dark["secondary"] %>;
    --secondary-foreground: <%- colors.dark["secondary-foreground"] %>;
    --muted: <%- colors.dark["muted"] %>;
    --muted-foreground: <%- colors.dark["muted-foreground"] %>;
    --accent: <%- colors.dark["accent"] %>;
    --accent-foreground: <%- colors.dark["accent-foreground"] %>;
    --destructive: <%- colors.dark["destructive"] %>;
    --destructive-foreground: <%- colors.dark["destructive-foreground"] %>;
    --border: <%- colors.dark["border"] %>;
    --input: <%- colors.dark["input"] %>;
    --ring: <%- colors.dark["ring"] %>;
    --chart-1: <%- colors.dark["chart-1"] %>;
    --chart-2: <%- colors.dark["chart-2"] %>;
    --chart-3: <%- colors.dark["chart-3"] %>;
    --chart-4: <%- colors.dark["chart-4"] %>;
    --chart-5: <%- colors.dark["chart-5"] %>;
  }
}

@layer base {
  * {
    @apply border-border;
  }
  body {
    @apply bg-background text-foreground;
  }
}`;

  for (const baseColor of ["slate", "gray", "zinc", "neutral", "stone"]) {
    const base: Record<string, any> = {
      inlineColors: {},
      cssVars: {},
    };
    for (const [mode, values] of Object.entries(colorMapping)) {
      base.inlineColors[mode] = {};
      base.cssVars[mode] = {};
      for (const [key, value] of Object.entries(values)) {
        if (typeof value === "string") {
          // Chart colors do not have a 1-to-1 mapping with tailwind colors.
          if (key.startsWith("chart-")) {
            base.cssVars[mode][key] = value;
            continue;
          }

          const resolvedColor = value.replace(/\{\{base\}\}-/g, `${baseColor}-`);
          base.inlineColors[mode][key] = resolvedColor;

          const [resolvedBase, scale] = resolvedColor.split("-");
          const color = scale
            ? colorsData[resolvedBase].find((item: any) => item.scale === Number.parseInt(scale))
            : colorsData[resolvedBase];
          if (color) {
            base.cssVars[mode][key] = color.hslChannel;
          }
        }
      }
    }

    // Build css vars.
    base.inlineColorsTemplate = template(BASE_STYLES)({});
    base.cssVarsTemplate = template(BASE_STYLES_WITH_VARIABLES)({
      colors: base.cssVars,
    });

    await writeFile(
      path.join(REGISTRY_PATH, `colors/${baseColor}.json`),
      JSON.stringify(base, null, 2),
    );

    // ----------------------------------------------------------------------------
    // Build registry/themes.css
    // ----------------------------------------------------------------------------
    const THEME_STYLES_WITH_VARIABLES = `
.theme-<%- theme %> {
  --background: <%- colors.light["background"] %>;
  --foreground: <%- colors.light["foreground"] %>;

  --muted: <%- colors.light["muted"] %>;
  --muted-foreground: <%- colors.light["muted-foreground"] %>;

  --popover: <%- colors.light["popover"] %>;
  --popover-foreground: <%- colors.light["popover-foreground"] %>;

  --card: <%- colors.light["card"] %>;
  --card-foreground: <%- colors.light["card-foreground"] %>;

  --border: <%- colors.light["border"] %>;
  --input: <%- colors.light["input"] %>;

  --primary: <%- colors.light["primary"] %>;
  --primary-foreground: <%- colors.light["primary-foreground"] %>;

  --secondary: <%- colors.light["secondary"] %>;
  --secondary-foreground: <%- colors.light["secondary-foreground"] %>;

  --accent: <%- colors.light["accent"] %>;
  --accent-foreground: <%- colors.light["accent-foreground"] %>;

  --destructive: <%- colors.light["destructive"] %>;
  --destructive-foreground: <%- colors.light["destructive-foreground"] %>;

  --ring: <%- colors.light["ring"] %>;

  --radius: <%- colors.light["radius"] %>;
}

.dark .theme-<%- theme %> {
  --background: <%- colors.dark["background"] %>;
  --foreground: <%- colors.dark["foreground"] %>;

  --muted: <%- colors.dark["muted"] %>;
  --muted-foreground: <%- colors.dark["muted-foreground"] %>;

  --popover: <%- colors.dark["popover"] %>;
  --popover-foreground: <%- colors.dark["popover-foreground"] %>;

  --card: <%- colors.dark["card"] %>;
  --card-foreground: <%- colors.dark["card-foreground"] %>;

  --border: <%- colors.dark["border"] %>;
  --input: <%- colors.dark["input"] %>;

  --primary: <%- colors.dark["primary"] %>;
  --primary-foreground: <%- colors.dark["primary-foreground"] %>;

  --secondary: <%- colors.dark["secondary"] %>;
  --secondary-foreground: <%- colors.dark["secondary-foreground"] %>;

  --accent: <%- colors.dark["accent"] %>;
  --accent-foreground: <%- colors.dark["accent-foreground"] %>;

  --destructive: <%- colors.dark["destructive"] %>;
  --destructive-foreground: <%- colors.dark["destructive-foreground"] %>;

  --ring: <%- colors.dark["ring"] %>;
}`;

    const themeCSS = [];
    for (const theme of baseColors) {
      themeCSS.push(
        template(THEME_STYLES_WITH_VARIABLES)({
          colors: theme.cssVars,
          theme: theme.name,
        }),
      );
    }

    await writeFile(path.join(REGISTRY_PATH, `themes.css`), themeCSS.join("\n"));

    // ----------------------------------------------------------------------------
    // Build registry/themes/[theme].json
    // ----------------------------------------------------------------------------
    rimraf.sync(path.join(REGISTRY_PATH, "themes"));
    for (const baseColor of ["slate", "gray", "zinc", "neutral", "stone"]) {
      const payload: Record<string, any> = {
        name: baseColor,
        label: baseColor.charAt(0).toUpperCase() + baseColor.slice(1),
        cssVars: {},
      };
      for (const [mode, values] of Object.entries(colorMapping)) {
        payload.cssVars[mode] = {};
        for (const [key, value] of Object.entries(values)) {
          if (typeof value === "string") {
            const resolvedColor = value.replace(/\{\{base\}\}-/g, `${baseColor}-`);
            payload.cssVars[mode][key] = resolvedColor;

            const [resolvedBase, scale] = resolvedColor.split("-");
            const color = scale
              ? colorsData[resolvedBase].find((item: any) => item.scale === Number.parseInt(scale))
              : colorsData[resolvedBase];
            if (color) {
              payload.cssVars[mode][key] = color.hslChannel;
            }
          }
        }
      }

      const targetPath = path.join(REGISTRY_PATH, "themes");

      // Create directory if it doesn't exist.
      if (!existsSync(targetPath)) {
        await fs.mkdir(targetPath, { recursive: true });
      }

      await writeFile(
        path.join(targetPath, `${payload.name}.json`),
        JSON.stringify(payload, null, 2),
      );
    }
  }
}

try {
  // check if the __registry__ and public/r directories exist, if not, create them.
  if (!existsSync(path.join(process.cwd(), "__registry__"))) {
    await fs.mkdir(path.join(process.cwd(), "__registry__"), { recursive: true });
  }
  if (!existsSync(REGISTRY_PATH)) {
    await fs.mkdir(REGISTRY_PATH, { recursive: true });
  }

  const content = await crawlContent();
  const result = registrySchema.safeParse([...registry, ...content]);

  // await writeFile(
  //   path.join(REGISTRY_PATH, "temp.json"),
  //   JSON.stringify(result.data ?? "", null, 2),
  // );

  if (!result.success) {
    console.error(result.error);
    process.exit(1);
  }

  await buildRegistry(result.data);
  await buildBlockRegistry(result.data);
  await buildStyles(result.data);
  await buildThemes();

  // eslint-disable-next-line no-console
  console.log("✅ Done!");
} catch (error) {
  console.error(error);
  process.exit(1);
}

async function writeFile(path: string, payload: any) {
  return fs.writeFile(path, `${payload}\r\n`, "utf8");
}
