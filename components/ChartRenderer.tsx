import React from 'react';
import {
  BarChart, Bar, LineChart, Line, AreaChart, Area, PieChart, Pie,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell
} from 'recharts';

export interface ChartData {
  type: 'bar' | 'line' | 'area' | 'pie';
  title?: string;
  data: any[];
  xAxisKey: string; // Key for X-axis categories
  series: Array<{
    dataKey: string;
    name?: string;
    color?: string;
    stackId?: string;
  }>;
}

interface ChartRendererProps {
  config: ChartData;
}

// Default glass-theme colors
const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316'];

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-gray-900/90 border border-white/20 backdrop-blur-xl p-3 rounded-xl shadow-xl">
        <p className="text-white font-medium text-sm mb-1">{label}</p>
        {payload.map((p: any, idx: number) => (
          <div key={idx} className="flex items-center gap-2 text-xs">
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
            <span className="text-white/70">{p.name}:</span>
            <span className="text-white font-mono font-bold">{p.value}</span>
          </div>
        ))}
      </div>
    );
  }
  return null;
};

export const ChartRenderer: React.FC<ChartRendererProps> = ({ config }) => {
  const { type, title, data, xAxisKey, series } = config;

  // Helper to get color
  const getColor = (index: number, specificColor?: string) => specificColor || COLORS[index % COLORS.length];

  const renderChart = () => {
    const commonProps = {
      data: data,
      margin: { top: 10, right: 10, left: -20, bottom: 0 }
    };

    switch (type) {
      case 'bar':
        return (
          <BarChart {...commonProps}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" vertical={false} />
            <XAxis 
              dataKey={xAxisKey} 
              stroke="rgba(255,255,255,0.5)" 
              tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 10 }} 
              tickLine={{ stroke: 'rgba(255,255,255,0.2)' }}
            />
            <YAxis 
              stroke="rgba(255,255,255,0.5)" 
              tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 10 }} 
              tickLine={{ stroke: 'rgba(255,255,255,0.2)' }}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.05)' }} />
            <Legend wrapperStyle={{ paddingTop: '10px' }} />
            {series.map((s, i) => (
              <Bar 
                key={s.dataKey} 
                dataKey={s.dataKey} 
                name={s.name || s.dataKey} 
                fill={getColor(i, s.color)} 
                stackId={s.stackId}
                radius={[4, 4, 0, 0]}
                animationDuration={1500}
              />
            ))}
          </BarChart>
        );

      case 'line':
        return (
          <LineChart {...commonProps}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" vertical={false} />
            <XAxis 
              dataKey={xAxisKey} 
              stroke="rgba(255,255,255,0.5)" 
              tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 10 }}
              tickLine={{ stroke: 'rgba(255,255,255,0.2)' }}
            />
            <YAxis 
              stroke="rgba(255,255,255,0.5)" 
              tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 10 }}
              tickLine={{ stroke: 'rgba(255,255,255,0.2)' }}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend wrapperStyle={{ paddingTop: '10px' }} />
            {series.map((s, i) => (
              <Line 
                key={s.dataKey} 
                type="monotone" 
                dataKey={s.dataKey} 
                name={s.name || s.dataKey} 
                stroke={getColor(i, s.color)} 
                strokeWidth={3}
                dot={{ r: 4, fill: getColor(i, s.color), strokeWidth: 0 }}
                activeDot={{ r: 6, strokeWidth: 0 }}
                animationDuration={1500}
              />
            ))}
          </LineChart>
        );

      case 'area':
        return (
          <AreaChart {...commonProps}>
            <defs>
              {series.map((s, i) => (
                <linearGradient key={s.dataKey} id={`color${s.dataKey}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={getColor(i, s.color)} stopOpacity={0.3}/>
                  <stop offset="95%" stopColor={getColor(i, s.color)} stopOpacity={0}/>
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" vertical={false} />
            <XAxis 
              dataKey={xAxisKey} 
              stroke="rgba(255,255,255,0.5)" 
              tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 10 }}
              tickLine={{ stroke: 'rgba(255,255,255,0.2)' }}
            />
            <YAxis 
              stroke="rgba(255,255,255,0.5)" 
              tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 10 }}
              tickLine={{ stroke: 'rgba(255,255,255,0.2)' }}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend wrapperStyle={{ paddingTop: '10px' }} />
            {series.map((s, i) => (
              <Area 
                key={s.dataKey} 
                type="monotone" 
                dataKey={s.dataKey} 
                name={s.name || s.dataKey} 
                stroke={getColor(i, s.color)} 
                fillOpacity={1} 
                fill={`url(#color${s.dataKey})`} 
                animationDuration={1500}
              />
            ))}
          </AreaChart>
        );

      case 'pie':
        const primarySeries = series[0]; // Pie charts typically handle one metric split by categories
        return (
          <PieChart>
             <Tooltip content={<CustomTooltip />} />
             <Legend wrapperStyle={{ paddingTop: '10px' }} />
             <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={60}
              outerRadius={80}
              paddingAngle={5}
              dataKey={primarySeries.dataKey}
              nameKey={xAxisKey} // Use xAxisKey as the Label Key for pie slices
              stroke="none"
            >
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={getColor(index)} />
              ))}
            </Pie>
          </PieChart>
        );
        
      default:
        return <div className="text-red-400 text-xs">Unsupported chart type</div>;
    }
  };

  return (
    <div className="w-full my-4 bg-white/5 border border-white/10 rounded-xl p-4 backdrop-blur-md overflow-hidden">
      {title && <h3 className="text-sm font-semibold text-white/90 mb-4 ml-1">{title}</h3>}
      <div className="h-[250px] w-full text-xs font-sans">
        <ResponsiveContainer width="100%" height="100%">
          {renderChart()}
        </ResponsiveContainer>
      </div>
    </div>
  );
};
