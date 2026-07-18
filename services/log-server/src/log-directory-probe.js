import { open, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

const PROBE_PREFIX = ".paletcam-log-write-probe-";
const PROBE_CONTENT = "paletcam log directory readiness probe\n";

const defaultDependencies = {
  createProbeId: randomUUID,
  openFile: open,
  removeFile: rm,
};

function throwProbeErrors(errors, logDirectory) {
  if (errors.length === 0) return;
  if (errors.length === 1) throw errors[0];

  throw new AggregateError(
    errors,
    `Log directory readiness probe failed and cleanup was incomplete: ${logDirectory}`,
  );
}

export async function probeLogDirectoryWritable(logDirectory, dependencies = {}) {
  const { createProbeId, openFile, removeFile } = {
    ...defaultDependencies,
    ...dependencies,
  };
  const probeFilename = `${PROBE_PREFIX}${process.pid}-${createProbeId()}.tmp`;
  const probePath = join(logDirectory, probeFilename);
  const errors = [];
  let probeFile = null;
  let createdProbe = false;

  try {
    probeFile = await openFile(probePath, "wx", 0o600);
    createdProbe = true;
    await probeFile.writeFile(PROBE_CONTENT, "utf8");
    await probeFile.sync();
  } catch (error) {
    errors.push(error);
  }

  if (probeFile) {
    try {
      await probeFile.close();
    } catch (error) {
      errors.push(error);
    }
  }

  if (createdProbe) {
    try {
      await removeFile(probePath);
    } catch (error) {
      if (error?.code !== "ENOENT") errors.push(error);
    }
  }

  throwProbeErrors(errors, logDirectory);
}
