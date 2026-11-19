import { readTemplate, tableCells } from "../server/template";
import { child, children, descendants } from "../server/xml";

/** Only form geometry and the four fixed cover marks enter the browser bundle. */
export async function formLayout() {
  const template = readTemplate(new Uint8Array(await Bun.file("assets/template/weekly-plan.hwpx").arrayBuffer()));
  const byItem: Record<string, number[]> = {}, bySection: Record<string, number[][]> = {};
  for (const [id,item] of template.items) byItem[id] = [item.body,item.assignee].map(
    cell => Number(child(cell,"hp:cellSz").attributes.height));
  for (const dep of template.departments) {
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
  return { byItem, bySection, cover };
}
