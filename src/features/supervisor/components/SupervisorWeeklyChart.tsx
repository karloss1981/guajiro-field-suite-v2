import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export default function SupervisorWeeklyChart({data,lang='en'}:{data:any[];lang?:string}){
  return <ResponsiveContainer width="100%" height={120}>
    <LineChart data={data} margin={{top:5,right:5,left:-20,bottom:0}}>
      <CartesianGrid strokeDasharray="3 3" stroke="#162e58" vertical={false}/>
      <XAxis dataKey="date" tick={{fill:'#5a7aaa',fontSize:9}}/>
      <YAxis tick={{fill:'#5a7aaa',fontSize:9}} width={30}/>
      <Tooltip contentStyle={{background:'#0b1830',border:'1px solid #162e58',borderRadius:8,fontSize:11}}/>
      <Line type="monotone" dataKey="done" stroke="#00dc85" strokeWidth={2} dot={false} name={lang==='es'?'Completados':'Done'}/>
      <Line type="monotone" dataKey="notdone" stroke="#ff3348" strokeWidth={2} dot={false} name={lang==='es'?'No Completados':'Not Done'}/>
    </LineChart>
  </ResponsiveContainer>;
}
