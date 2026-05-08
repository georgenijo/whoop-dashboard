#!/bin/sh
set -e

brew install xcodegen

cd "$CI_PRIMARY_REPOSITORY_PATH/apps/ios"
xcodegen generate
