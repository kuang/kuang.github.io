const usData = {
  values: {
    NGDPDPC: {
      USA: {
        1980: 12552.943,
        1981: 13948.701,
        1982: 14404.994,
        1983: 15513.679,
        1984: 17086.441,
        1985: 18199.32,
        1986: 19034.766,
        1987: 20000.968,
        1988: 21375.999,
        1989: 22814.077,
        1990: 23847.977,
        1991: 24302.776,
        1992: 25392.931,
        1993: 26364.192,
        1994: 27674.021,
        1995: 28671.48,
        1996: 29946.973,
        1997: 31440.087,
        1998: 32833.666,
        1999: 34496.241,
        2000: 36312.782,
        2001: 37101.453,
        2002: 37945.761,
        2003: 39405.354,
        2004: 41641.617,
        2005: 44034.256,
        2006: 46216.853,
        2007: 47943.353,
        2008: 48470.553,
        2009: 47102.428,
        2010: 48586.288,
        2011: 50008.108,
        2012: 51736.738,
        2013: 53363.904,
        2014: 55263.817,
        2015: 57006.926,
        2016: 58179.697,
        2017: 60292.978,
        2018: 63165.278,
        2019: 65504.783,
        2020: 64367.435,
        2021: 70995.794,
        2022: 77191.871,
        2023: 81632.253,
        2024: 85372.686,
        2025: 87978.472,
        2026: 90902.779,
        2027: 94011.701,
        2028: 97230.612,
        2029: 100579.865,
      },
    },
  },
  api: {
    version: "1",
    "output-method": "json",
  },
};

const chinaData = {
  values: {
    NGDPDPC: {
      CHN: {
        1980: 306.98,
        1981: 288.491,
        1982: 279.971,
        1983: 296.509,
        1984: 301.111,
        1985: 292.99,
        1986: 279.908,
        1987: 299.842,
        1988: 368.079,
        1989: 406.534,
        1990: 346.873,
        1991: 356.759,
        1992: 420.025,
        1993: 520.966,
        1994: 468.658,
        1995: 603.526,
        1996: 703.06,
        1997: 774.91,
        1998: 820.903,
        1999: 865.236,
        2000: 951.163,
        2001: 1044.958,
        2002: 1141.14,
        2003: 1282.21,
        2004: 1499.712,
        2005: 1751.368,
        2006: 2095.239,
        2007: 2691.048,
        2008: 3446.695,
        2009: 3813.408,
        2010: 4499.803,
        2011: 5553.242,
        2012: 6282.709,
        2013: 7039.574,
        2014: 7645.875,
        2015: 8034.287,
        2016: 8063.446,
        2017: 8760.259,
        2018: 9848.949,
        2019: 10170.061,
        2020: 10525.001,
        2021: 12572.071,
        2022: 12642.847,
        2023: 12513.871,
        2024: 13136.482,
        2025: 14037.338,
        2026: 14928.761,
        2027: 15833.571,
        2028: 16781.705,
        2029: 17704.741,
      },
    },
  },
  api: {
    version: "1",
    "output-method": "json",
  },
};

const transformData = (data) =>
  Object.keys(data)
    .filter((year) => {
      return year < 2025;
    })
    .map((year) => ({
      x: year,
      y: data[year],
    }));

// set the dimensions and margins of the graph
var margin = { top: 50, right: 50, bottom: 30, left: 50 },
  width = 700 - margin.left - margin.right,
  height = 400 - margin.top - margin.bottom;

// append the svg object to the body of the page
var svG = d3
  .select("#line_graph")
  .append("svg")
  .attr("width", width + margin.left + margin.right)
  .attr("height", height + margin.top + margin.bottom)
  .append("g")
  .attr("transform", "translate(" + margin.left + "," + margin.top + ")");

// X scale and Axis
var x = d3
  .scaleLinear()
  .domain([1980, 2030]) // This is the min and the max of the data: 0 to 100 if percentages
  .range([0, width]); // This is the corresponding value I want in Pixel
svG
  .append("g")
  .attr("transform", "translate(0," + height + ")")
  .call(d3.axisBottom(x));

// Y scale and Axis
var y = d3
  .scaleLinear()
  .domain([0, 100000]) // This is the min and the max of the data: 0 to 100 if percentages
  .range([height, 0]); // This is the corresponding value I want in Pixel
svG.append("g").call(d3.axisLeft(y));

svG
  .append("path")
  .datum(transformData(usData.values.NGDPDPC.USA))
  .attr("fill", "none")
  .attr("stroke", "#69b3a2")
  .attr("stroke-width", 4)
  .attr("class", "country_line")
  .attr(
    "d",
    d3
      .line()
      .x((d) => x(d.x))
      .y((d) => y(d.y))
  );

svG
  .append("path")
  .datum(transformData(chinaData.values.NGDPDPC.CHN))
  .attr("fill", "none")
  .attr("stroke", "#69b3a2")
  .attr("stroke-width", 4)
  .attr("class", "country_line")
  .attr(
    "d",
    d3
      .line()
      .x((d) => x(d.x))
      .y((d) => y(d.y))
  );

// append a g for all the mouse over nonsense
var mouseG = svG.append("g").attr("class", "mouse-over-effects");

// this is the vertical line
mouseG
  .append("path")
  .attr("class", "mouse-line")
  .style("stroke", "black")
  .style("stroke-width", "1px")
  .style("opacity", "0");

// keep a reference to all our lines
var lines = document.getElementsByClassName("country_line");

// here's a g for each circle and text on the line
var mousePerLine = mouseG
  .selectAll(".mouse-per-line")
  .data(d3.range(lines.length))
  .enter()
  .append("g")
  .attr("class", "mouse-per-line");

// the circle
mousePerLine
  .append("circle")
  .attr("r", 3)
  .style("stroke", "black")
  .style("fill", "black")
  .style("stroke-width", "1px")
  .style("opacity", "0");

// rect to capture mouse movements
mouseG
  .append("svg:rect")
  .attr("width", width)
  .attr("height", height)
  .attr("fill", "none")
  .attr("pointer-events", "all")
  .on("mousemove", function () {
    // mouse moving over canvas
    var mouse = d3.mouse(this);
    const year = Math.round(x.invert(mouse[0]));

    // if no data, don't do anything
    if (year < 1980 || year > 2024) {
      d3.select(".mouse-line").style("opacity", "0");
      d3.selectAll(".mouse-per-line circle").style("opacity", "0");
      d3.selectAll(".mouse-per-line text").style("opacity", "0");
    } else {
      d3.select(".mouse-line").style("opacity", "1");
      d3.selectAll(".mouse-per-line circle").style("opacity", "1");
      d3.selectAll(".mouse-per-line text").style("opacity", "1");
    }

    // move the vertical line
    d3.select(".mouse-line").attr("d", function () {
      var d = "M" + mouse[0] + "," + height;
      d += " " + mouse[0] + "," + 0;
      return d;
    });

    // position the circles
    d3.selectAll(".mouse-per-line").attr("transform", function (d, i) {
      var beginning = 0,
        end = lines[i].getTotalLength(),
        target = null;

      while (true) {
        target = Math.floor((beginning + end) / 2);
        pos = lines[i].getPointAtLength(target);
        if ((target === end || target === beginning) && pos.x !== mouse[0]) {
          break;
        }
        if (pos.x > mouse[0]) end = target;
        else if (pos.x < mouse[0]) beginning = target;
        else break; //position found
      }

      // return position
      return "translate(" + mouse[0] + "," + pos.y + ")";
    });

    // update the text
    let countryData = "";
    for (country of ["USA", "CHN"]) {
      const countryDataPoint = transformData(
        country === "USA"
          ? usData.values.NGDPDPC.USA
          : chinaData.values.NGDPDPC.CHN
      ).find((dataPoint) => dataPoint.x == year);
      countryData += `${country}: $${Math.trunc(
        countryDataPoint?.y
      )} USD </br>`;
    }
    d3.select("#caption").html(`year: ${year} </br> ${countryData}`);
  });
