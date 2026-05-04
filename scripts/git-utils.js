import { execSync } from "node:child_process";

export function getGitBranchName() {
  try {
    const branchName = execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf8" }).trim();
    return branchName === "HEAD" ? "" : branchName;
  } catch (_error) {
    return "";
  }
}

export function resolveDeployBranchName() {
  const envBranchName = [
    process.env.PALETCAM_DEPLOY_BRANCH,
    process.env.DEPLOY_BRANCH,
    process.env.BRANCH,
    process.env.HEAD,
    process.env.GIT_BRANCH,
  ].find((value) => String(value || "").trim());

  return String(envBranchName || getGitBranchName()).trim();
}
