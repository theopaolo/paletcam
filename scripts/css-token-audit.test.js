import { describe, expect, it } from "bun:test";
import { analyzeCssSources, extractLitCssSources, parseDeclarations } from "./css-token-audit.js";

describe("parseDeclarations", () => {
  it("parses declarations from nested CSS blocks", () => {
    const declarations = parseDeclarations(
      `
      :root {
        --accent-color: #ffc800;
      }

      @media (max-width: 600px) {
        .button {
          padding: 0.5rem 1rem;
          background: linear-gradient(180deg, #1f1f1f 0%, #111111 100%);
        }
      }
    `,
      "public/styles/example.css",
    );

    expect(declarations).toEqual([
      {
        filePath: "public/styles/example.css",
        line: 3,
        property: "--accent-color",
        value: "#ffc800",
      },
      {
        filePath: "public/styles/example.css",
        line: 8,
        property: "padding",
        value: "0.5rem 1rem",
      },
      {
        filePath: "public/styles/example.css",
        line: 9,
        property: "background",
        value: "linear-gradient(180deg, #1f1f1f 0%, #111111 100%)",
      },
    ]);
  });
});

describe("analyzeCssSources", () => {
  it("extracts repeated raw values and existing tokens", () => {
    const report = analyzeCssSources(
      [
        {
          content: `
            :root {
              --accent-color: #ffc800;
            }

            .alpha {
              color: #ffc800;
              gap: 0.5rem;
              transition: color 0.2s ease;
            }
          `,
          filePath: "public/styles/settings/tokens.css",
        },
        {
          content: `
            .beta {
              border-color: #ffc800;
              padding: 0.5rem 1rem;
              transition: opacity 0.2s ease;
            }
          `,
          filePath: "public/styles/beta.css",
        },
      ],
      { minOccurrences: 2 },
    );

    expect(report.designTokens).toEqual([
      {
        filePath: "public/styles/settings/tokens.css",
        line: 3,
        name: "--accent-color",
        value: "#ffc800",
      },
    ]);
    expect(report.categories.color[0]).toMatchObject({
      matchingExistingTokens: ["--accent-color"],
      sampleValue: "#ffc800",
      usageCount: 2,
    });
    expect(report.categories.space[0]).toMatchObject({
      sampleValue: "0.5rem",
      usageCount: 2,
    });
    expect(report.categories.duration[0]).toMatchObject({
      sampleValue: "0.2s",
      usageCount: 2,
    });
    expect(report.categories.easing[0]).toMatchObject({
      sampleValue: "ease",
      usageCount: 2,
    });
  });

  it("extracts Lit css template literals with source line numbers", () => {
    const report = analyzeCssSources(
      extractLitCssSources(
        `
          import { css, LitElement } from "lit";

          class ExampleElement extends LitElement {
            static styles = css\`
              .alpha {
                gap: 0.5rem;
                transition: opacity 0.2s ease;
              }
            \`;
          }
        `,
        "src/example-element.js",
      ),
      { minOccurrences: 1 },
    );

    expect(report.litSourceCount).toBe(1);
    expect(report.cssFileCount).toBe(0);
    expect(report.categories.space[0]).toMatchObject({
      sampleValue: "0.5rem",
      usageCount: 1,
      usages: [
        expect.objectContaining({
          filePath: "src/example-element.js",
          line: 7,
          property: "gap",
        }),
      ],
    });
    expect(report.categories.duration[0]).toMatchObject({
      sampleValue: "0.2s",
      usageCount: 1,
    });
    expect(report.categories.easing[0]).toMatchObject({
      sampleValue: "ease",
      usageCount: 1,
    });
  });
});
