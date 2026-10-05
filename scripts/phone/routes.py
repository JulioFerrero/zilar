"""Reads changed file paths on stdin, prints the static expo-router routes they define."""
import re
import sys

seen = []
for line in sys.stdin:
    path = line.strip()
    if not path.endswith(('.tsx', '.ts')) or '.test.' in path:
        continue
    rel = re.sub(r'^apps/mobile/src/app/', '', path)
    rel = re.sub(r'\.tsx?$', '', rel)
    parts = [p for p in rel.split('/') if not (p.startswith('(') and p.endswith(')'))]
    if parts and parts[-1] == 'index':
        parts = parts[:-1]
    if parts and parts[-1] == '_layout':
        parts = parts[:-1]
    route = '/' + '/'.join(parts)
    if route not in seen:
        seen.append(route)
print('\n'.join(seen))
