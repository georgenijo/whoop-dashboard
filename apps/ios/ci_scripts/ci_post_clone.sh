#!/bin/sh
set -eu

cd "$CI_PRIMARY_REPOSITORY_PATH/apps/ios"

# Catch UI edits or toolchain drift before generating/compiling the project.
expected_build=$(plutil -extract xcode.version raw -o - ci/workflows.json)
actual_build=$(xcodebuild -version | awk '/^Build version / { print $3 }')
if [ "$actual_build" != "$expected_build" ]; then
  echo "Xcode build mismatch: expected $expected_build, got $actual_build." >&2
  echo "Run scripts/ios-cloud.py doctor from the repository root; update pins intentionally." >&2
  exit 1
fi

if ! command -v xcodegen >/dev/null 2>&1; then
  brew install xcodegen
fi
xcodegen generate
