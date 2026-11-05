import os, zipfile, random
from xml.sax.saxutils import escape as e
from dados import NOTAS
random.seed(37)
def dv11(base):
    s=0; p=2
    for d in reversed(base): s+=int(d)*p; p=p+1 if p<9 else 2
    r=s%11; return '0' if r<2 else str(11-r)
def cnpj_ok(c):
    def dv(b,pesos): s=sum(int(x)*y for x,y in zip(b,pesos)); r=s%11; return '0' if r<2 else str(11-r)
    d1=dv(c[:12],[5,4,3,2,9,8,7,6,5,4,3,2]); d2=dv(c[:12]+d1,[6,5,4,3,2,9,8,7,6,5,4,3,2]); return c[12:]==d1+d2
EMIT_CNPJ='11222333000100'          # fictício (dígito verificador inválido de propósito)
assert not cnpj_ok(EMIT_CNPJ)
SAIDA='rotav3-notas-teste'; os.makedirs(SAIDA,exist_ok=True)
docs=[]
for i,(cli,rua,nro,cpl,bairro,(cidade,cmun),cep,peso,vol) in enumerate(NOTAS,1):
    nnf=900000+i; serie=1; cnf=f'{random.randint(10000000,99999999)}'
    base=f'35{2611}{EMIT_CNPJ}55{serie:03d}{nnf:09d}1{cnf}'
    chave=base+dv11(base); assert len(chave)==44
    dcnpj=f'99888777{i:04d}00'
    if cnpj_ok(dcnpj): dcnpj=dcnpj[:12]+'01'
    assert not cnpj_ok(dcnpj)
    q=vol; vun=round(random.uniform(20,90),2); vprod=round(q*vun,2)
    pl=round(peso*0.95,2)
    xcpl=f'<xCpl>{e(cpl)}</xCpl>' if cpl else ''
    nfe=f'''<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe Id="NFe{chave}" versao="4.00">
<ide><cUF>35</cUF><cNF>{cnf}</cNF><natOp>VENDA - TESTE SEM VALOR FISCAL</natOp><mod>55</mod><serie>{serie}</serie><nNF>{nnf}</nNF><dhEmi>2026-11-02T08:00:00-03:00</dhEmi><tpNF>1</tpNF><idDest>1</idDest><cMunFG>3518800</cMunFG><tpImp>1</tpImp><tpEmis>1</tpEmis><cDV>{chave[-1]}</cDV><tpAmb>2</tpAmb><finNFe>1</finNFe><indFinal>0</indFinal><indPres>9</indPres><procEmi>0</procEmi><verProc>ROTAV3-TESTE</verProc></ide>
<emit><CNPJ>{EMIT_CNPJ}</CNPJ><xNome>EMPRESA TESTE ROTAV3 - SEM VALOR FISCAL</xNome><xFant>TESTE ROTAV3</xFant><enderEmit><xLgr>Avenida Tiradentes</xLgr><nro>1301</nro><xBairro>Centro</xBairro><cMun>3518800</cMun><xMun>Guarulhos</xMun><UF>SP</UF><CEP>07010001</CEP><cPais>1058</cPais><xPais>BRASIL</xPais></enderEmit><IE>ISENTO</IE><CRT>1</CRT></emit>
<dest><CNPJ>{dcnpj}</CNPJ><xNome>{e(cli.upper())} (TESTE)</xNome><enderDest><xLgr>{e(rua)}</xLgr><nro>{e(nro)}</nro>{xcpl}<xBairro>{e(bairro)}</xBairro><cMun>{cmun}</cMun><xMun>{e(cidade)}</xMun><UF>SP</UF><CEP>{cep}</CEP><cPais>1058</cPais><xPais>BRASIL</xPais></enderDest><indIEDest>9</indIEDest></dest>
<det nItem="1"><prod><cProd>TESTE{i:03d}</cProd><cEAN>SEM GTIN</cEAN><xProd>MERCADORIA DE TESTE (SEM VALOR FISCAL)</xProd><NCM>39239000</NCM><CFOP>5102</CFOP><uCom>CX</uCom><qCom>{q}.0000</qCom><vUnCom>{vun:.4f}</vUnCom><vProd>{vprod:.2f}</vProd><cEANTrib>SEM GTIN</cEANTrib><uTrib>CX</uTrib><qTrib>{q}.0000</qTrib><vUnTrib>{vun:.4f}</vUnTrib><indTot>1</indTot></prod><imposto><ICMS><ICMSSN102><orig>0</orig><CSOSN>102</CSOSN></ICMSSN102></ICMS></imposto></det>
<total><ICMSTot><vBC>0.00</vBC><vICMS>0.00</vICMS><vICMSDeson>0.00</vICMSDeson><vFCP>0.00</vFCP><vBCST>0.00</vBCST><vST>0.00</vST><vFCPST>0.00</vFCPST><vFCPSTRet>0.00</vFCPSTRet><vProd>{vprod:.2f}</vProd><vFrete>0.00</vFrete><vSeg>0.00</vSeg><vDesc>0.00</vDesc><vII>0.00</vII><vIPI>0.00</vIPI><vIPIDevol>0.00</vIPIDevol><vPIS>0.00</vPIS><vCOFINS>0.00</vCOFINS><vOutro>0.00</vOutro><vNF>{vprod:.2f}</vNF></ICMSTot></total>
<transp><modFrete>0</modFrete><vol><qVol>{vol}</qVol><esp>CAIXA</esp><pesoL>{pl:.3f}</pesoL><pesoB>{peso:.3f}</pesoB></vol></transp>
<pag><detPag><tPag>90</tPag><vPag>0.00</vPag></detPag></pag>
<infAdic><infCpl>ARQUIVO DE TESTE PARA O SISTEMA ROTAV3. SEM VALOR FISCAL. CLIENTE, CNPJ E MERCADORIA FICTICIOS; O ENDERECO E REAL SO PARA TESTAR O MAPA.</infCpl></infAdic>
</infNFe></NFe></nfeProc>'''
    nome=f'{SAIDA}/NF-{nnf}-teste.xml'
    open(nome,'w',encoding='utf-8').write('<?xml version="1.0" encoding="UTF-8"?>\n'+nfe+'\n')
    docs.append(nfe)
# um arquivo só com as 25 notas (mais fácil de importar pelo celular)
open('rotav3-25-notas-teste.xml','w',encoding='utf-8').write('<?xml version="1.0" encoding="UTF-8"?>\n<!-- 25 NF-e de TESTE para o sistema ROTAV3. Sem valor fiscal. -->\n<lote>\n'+'\n'.join(docs)+'\n</lote>\n')
with zipfile.ZipFile('rotav3-notas-teste-separadas.zip','w',zipfile.ZIP_DEFLATED) as z:
    for f in sorted(os.listdir(SAIDA)): z.write(f'{SAIDA}/{f}', f)
print(len(docs),'notas'); print(os.popen('ls -la rotav3-25-notas-teste.xml rotav3-notas-teste-separadas.zip').read())
