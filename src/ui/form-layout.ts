import { paragraphs, readTemplate, tableCells } from "../server/template";
import { categories } from "../shared/weekly-plan";
import { child, children, descendants, textContent } from "../server/xml";
import { templateTableStyles } from "../server/table-style";

/** Only form geometry and the four fixed cover marks enter the browser bundle. */
export async function formLayout() {
  const template = readTemplate(new Uint8Array(await Bun.file("assets/template/weekly-plan.hwpx").arrayBuffer()));
  const byItem: Record<string, number[]> = {}, bySection: Record<string, number[][]> = {};
  const prototype=[...template.items.values()].flatMap(i=>i.data.tables)[0];
  const titleStyles:Record<string,{text:string;style:boolean}[]>={};
  const out=child(template.tables.get(prototype.id)!,"hp:outMargin").attributes;
  for (const [id,item] of template.items) {
    const runs=children(paragraphs(item.body)[0],"hp:run").map(r=>({text:children(r,"hp:t").map(textContent).join(""),
      style:!!children(template.charProperties.get(r.attributes.charPrIDRef)!,"hh:supscript").length}));
    if(runs.some(r=>r.style))titleStyles[id]=runs;
    const body=item.body, margin=(body.attributes.hasMargin==="1"?child(body,"hp:cellMargin"):child(item.table,"hp:inMargin")).attributes;
    byItem[id]=[...[body,item.assignee].map(cell=>Number(child(cell,"hp:cellSz").attributes.height)),
      Number(child(body,"hp:cellSz").attributes.width)-Number(margin.left)-Number(margin.right)-Number(out.left)-Number(out.right)];
  }
  for (const dep of template.departments) {
    for(const category of categories)byItem[`${dep.data.id}/${category}`]=byItem[dep.data.items[category][0].id];
    const mainIndex=dep.nodes.findIndex(p=>descendants(p,"hp:tbl").includes(dep.main));
    const nextIndex=dep.nodes.findIndex(p=>descendants(p,"hp:tbl").includes(dep.ongoing));
    const blankHeight=dep.nodes.slice(mainIndex+1,nextIndex).flatMap(p=>descendants(p,"hp:lineseg"))
      .reduce((height,line)=>height+Number(line.attributes.vertsize)+Number(line.attributes.spacing),0);
    const mainPos=child(dep.main,"hp:pos").attributes;
    const gap=blankHeight + Number(child(dep.main,"hp:outMargin").attributes.bottom) +
      Number(child(dep.ongoing,"hp:outMargin").attributes.top) +
      (mainPos.treatAsChar==="1" ? Number(descendants(dep.nodes[mainIndex],"hp:lineseg").at(-1)?.attributes.spacing ?? 0) : 0);
    bySection[dep.data.id] = [dep.main,dep.ongoing].map(table => {
      const cells=tableCells(table);
      return [Number(child(table,"hp:sz").attributes.width),
        Number(child(cells[0],"hp:cellSz").attributes.height),
        Number(child(tableCells(table)[Number(table.attributes.colCnt)],"hp:cellSz").attributes.height),
        Number(children(table,"hp:pos")[0]?.attributes.vertOffset ?? 0),gap];
    });
  }
  const cover=["image1.JPG","image2.JPG","image3.png","image4.png"].map(file=>
    `data:image/${file.endsWith("png")?"png":"jpeg"};base64,${Buffer.from(template.entries[`BinData/${file}`]).toString("base64")}`);
  return { byItem, bySection, cover, titleStyles,rowHeight:prototype.rowHeights[0],tableStyles:templateTableStyles(template) };
}
