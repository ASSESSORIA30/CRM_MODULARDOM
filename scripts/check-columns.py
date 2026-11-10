import re,glob,sys
out=set(); embeds=set()
for f in glob.glob('src/**/*.ts*',recursive=True):
    s=open(f).read()
    for m in re.finditer(r'\.from\("(\w+)"\)\s*\.select\("([^"]+)"', s):
        t,sel=m.group(1),m.group(2)
        depth=0;cur='';parts=[]
        for ch in sel:
            if ch=='(':depth+=1
            if ch==')':depth-=1
            if ch==',' and depth==0: parts.append(cur);cur=''
            else: cur+=ch
        parts.append(cur)
        for p in parts:
            p=p.strip()
            if p=='*': continue
            if '(' in p:
                name=p.split('(')[0]
                if ':' in name: name=name.split(':')[1]
                name=name.split('!')[0]
                inner=p[p.index('(')+1:p.rindex(')')]
                embeds.add((t,name))
                for c in re.split(r',(?![^(]*\))', inner):
                    c=c.strip()
                    if c and '(' not in c and c!='*': out.add((name,c))
                continue
            out.add((t,p))
for t,c in sorted(out): print('C',t,c)
for t,e in sorted(embeds): print('E',t,e)
rpcs=set()
for f in glob.glob('src/**/*.ts*',recursive=True):
    for m in re.finditer(r'\.rpc\("(\w+)"', open(f).read()): rpcs.add(m.group(1))
for r in sorted(rpcs): print('R',r)
