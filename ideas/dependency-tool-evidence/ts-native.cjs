const ts=require(process.env.TYPESCRIPT_MODULE || 'typescript');
const fs=require('fs'),path=require('path');
const root=path.resolve(process.argv[2] || path.join(__dirname,'fixtures/ts'));
const config=ts.readConfigFile(root+'/tsconfig.json',ts.sys.readFile);
const parsed=ts.parseJsonConfigFileContent(config.config,ts.sys,root);
const program=ts.createProgram(parsed.fileNames,parsed.options),checker=program.getTypeChecker();
const result=[];
for(const sf of program.getSourceFiles().filter(x=>x.fileName.startsWith(root))){
 function walk(n){
  if(ts.isCallExpression(n)||ts.isNewExpression(n)){
   const d=checker.getResolvedSignature(n)?.declaration;
   result.push({file:path.basename(sf.fileName),line:sf.getLineAndCharacterOfPosition(n.getStart()).line+1,expression:n.expression.getText(sf),target:d?{file:path.relative(root,d.getSourceFile().fileName),line:d.getSourceFile().getLineAndCharacterOfPosition(d.getStart()).line+1,kind:ts.SyntaxKind[d.kind],text:d.getText().slice(0,90)}:null});
  }ts.forEachChild(n,walk);
 }walk(sf);
}
console.log(JSON.stringify({version:ts.version,diagnostics:ts.getPreEmitDiagnostics(program).map(d=>ts.flattenDiagnosticMessageText(d.messageText,' ')),calls:result},null,2));
