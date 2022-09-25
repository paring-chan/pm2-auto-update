#!/bin/bash
REMOTE=$(git remote)

echo $(git config --get remote.$REMOTE.url)

echo $(git show-ref --head)
