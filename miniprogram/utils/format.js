// Build safe native rich-text nodes, never interpret model output as HTML.
function inline(text){
 const nodes=[];const pattern=/\*\*([^*]+)\*\*/g;let start=0,match;
 while((match=pattern.exec(text))){
  if(match.index>start)nodes.push({type:'text',text:text.slice(start,match.index)});
  nodes.push({name:'strong',children:[{type:'text',text:match[1]}]});start=pattern.lastIndex;
 }
 if(start<text.length)nodes.push({type:'text',text:text.slice(start)});
 return nodes;
}
function replyNodes(text){
 return String(text||'').replace(/\r\n/g,'\n').trim().split(/\n\s*\n/).filter(Boolean).map((paragraph,index,all)=>({
  name:'div',attrs:{style:'line-height:1.65;white-space:pre-wrap;word-break:break-word;'+(index<all.length-1?'margin-bottom:12px;':'')},
  children:paragraph.split('\n').flatMap((line,i)=>{
   const heading=/^#{1,3}\s+/.test(line),clean=heading?line.replace(/^#{1,3}\s+/,''):line;
   const children=heading?[{name:'strong',children:inline(clean)}]:inline(clean);
   return i?[{name:'br'}].concat(children):children;
  })
 }));
}
module.exports={replyNodes};
