import typescriptEslint from "typescript-eslint";

export default [
  {
    ignores: ["dist/**", "out/**", "node_modules/**"],
  },
  ...typescriptEslint.configs.recommended,
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: typescriptEslint.parser,
      ecmaVersion: 2022,
      sourceType: "module",
    },
    rules: {
      "@typescript-eslint/naming-convention": [
        "warn",
        {
          selector: "import",
          format: ["camelCase", "PascalCase"],
        },
      ],
      curly: "warn",
      eqeqeq: "warn",
      "no-throw-literal": "warn",
    },
  },
];
