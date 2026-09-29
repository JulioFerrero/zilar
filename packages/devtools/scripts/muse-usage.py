#!/usr/bin/env python3
"""Estimated Meta Model API spend of the Muse worker sessions (contributor tier prices).
Run: python3 packages/devtools/scripts/muse-usage.py"""
out=subprocess.run(['opencode2','api','session.list'],capture_output=True,text=True).stdout
d=json.loads(out)['data']
P_IN,P_CACHE,P_OUT=0.10,0.002,0.20   # USD per million tokens, contributor tier
tot=[0,0,0,0.0]
rows=[]
for s in d:
    m=s.get('model') or {}
    if m.get('providerID')!='meta': continue
    t=s.get('tokens',{})
    i,o,c=t.get('input',0),t.get('output',0),t.get('cache',{}).get('read',0)
    cost=(i*P_IN+c*P_CACHE+o*P_OUT)/1e6
    rows.append((s.get('title','?')[:44],i,c,o,cost))
    tot[0]+=i;tot[1]+=c;tot[2]+=o;tot[3]+=cost
print(f"{'session':46}{'input':>10}{'cached':>12}{'output':>9}{'est. USD':>10}")
for r in rows: print(f"{r[0]:46}{r[1]:>10}{r[2]:>12}{r[3]:>9}{r[4]:>10.3f}")
print(f"{'TOTAL':46}{tot[0]:>10}{tot[1]:>12}{tot[2]:>9}{tot[3]:>10.3f}")
