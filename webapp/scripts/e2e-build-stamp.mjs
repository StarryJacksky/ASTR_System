export function matchesBuildStamp(stamp, expected) {
  return (
    stamp?.version === expected.version &&
    stamp?.buildId === expected.buildId &&
    stamp?.coreMode === expected.coreMode &&
    stamp?.coreOrigin === expected.coreOrigin &&
    stamp?.sourceHash === expected.sourceHash
  );
}
