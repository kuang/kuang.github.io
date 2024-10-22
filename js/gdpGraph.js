// store map of country codes to country names in memory
const countryCodeMap = JSON.parse(localStorage["countryCodeMap"]) || {};
const countryColorsMap = {};
const NO_DATA_COUNTRY_LIST = [
  "KOS",
  "BES",
  "AIA",
  "ASM",
  "BMU",
  "CHI",
  "COK",
  "CUB",
  "CYM",
  "ESH",
  "FLK",
  "FRO",
  "GIB",
  "GLP",
  "GRL",
  "GUF",
  "GUM",
];
const getRandomColor = () => {
  return "#" + ((Math.random() * 0xffffff) << 0).toString(16).padStart(6, "0");
};

const transformData = (data) =>
  Object.keys(data || {})
    .filter((year) => {
      return year <= 2024;
    })
    .map((year) => ({
      x: year,
      y: data[year],
    }));

const renderLineGraph = (countryData) => {
  // set the dimensions and margins of the graph

  // get max GDP per capita across all countries
  const maxGDP = Math.max(
    ...countryData.map((country) => {
      return Math.max(...Object.values(country.data || {}));
    })
  );

  // X scale and Axis
  const x = d3
    .scaleLinear()
    .domain([1980, 2030]) // years
    .range([0, width]);

  svG
    .append("g")
    .attr("transform", "translate(0," + height + ")")
    .call(d3.axisBottom(x));

  // Y scale and Axis
  var y = d3.scaleLinear().domain([0, maxGDP]).range([height, 0]);
  svG.append("g").call(d3.axisLeft(y));

  for (country of countryData) {
    if (!country.data) continue; // don't plot if no data

    const randColor = countryColorsMap[country.name] ?? getRandomColor();
    countryColorsMap[country.name] = randColor; // store color in memory too

    svG
      .append("path")
      .datum(transformData(country.data))
      .attr("fill", "none")
      .attr("stroke", randColor) // TODO: hardcode USA as red/white/blue gradient stroke
      .attr("stroke-width", 3)
      .attr("class", "country_line")
      .attr(
        "d",
        d3
          .line()
          .x((d) => x(d.x))
          .y((d) => y(d.y))
      );

    // get most recent year of data
    const mostRecentYear = Object.keys(country.data).sort().reverse()[0];

    const mostRecentYearToUse = mostRecentYear > 2024 ? 2024 : mostRecentYear;

    // add country name to end of line
    svG
      .append("text")
      .attr(
        "transform",
        "translate(" +
          (x(mostRecentYearToUse) + 5) +
          "," +
          Math.min(y(country.data[mostRecentYearToUse]), height - 10) +
          ")"
      )
      .attr("dy", ".35em")
      .attr("text-anchor", "start")
      .style("fill", randColor)
      .text(country.name);
  }

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

  // here's a g for each circle on the line
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
      let countryDataText = "";

      for (country of countryData) {
        const countryDataPoint = transformData(country.data).find(
          (dataPoint) => dataPoint.x == year
        );

        const GDPperCapita = Math.trunc(countryDataPoint?.y);

        // some countries don't have data back to 1980, etc
        if (GDPperCapita) {
          countryDataText += `${country.name}: $${GDPperCapita} USD </br>`;
        }
      }
      d3.select("#caption").html(`year: ${year} </br> ${countryDataText}`);
    });
};

const fetchCountryData = async (countryCode) => {
  const data = await fetch(
    `https://corsproxy.io/?https://www.imf.org/external/datamapper/api/v1/NGDPDPC/${countryCode}/`
  )
    .then((response) => response.json())
    .catch((error) => console.error(error));

  if (!data.values) {
    // alert user that no data was found
    alert(`Data not available for ${countryCode}`);

    return null;
  }

  const cleanedData = data.values["NGDPDPC"][countryCode];
  return cleanedData;
};

const loadAndRenderGraph = async (countryCodeList) => {
  const finalCountryData = await Promise.all(
    countryCodeList.map(async (countryCode) => {
      const data = await fetchCountryData(countryCode);

      return {
        name: countryCodeMap[countryCode],
        data: data,
      };
    })
  );

  renderLineGraph(finalCountryData);
};

const addCountryOptions = async () => {
  if (!Object.keys(countryCodeMap).length) {
    const data = await fetch(
      "https://corsproxy.io/?https://www.imf.org/external/datamapper/api/v1/countries"
    )
      .then((response) => response.json())
      .catch((error) => console.error(error));

    Object.keys(data.countries).map((countryKey) => {
      let countryName = data.countries[countryKey].label;

      if (!countryName) return null;
      if (NO_DATA_COUNTRY_LIST.includes(countryKey)) return null;

      // some manual cleanup
      if (countryKey === "TWN") countryName = "Taiwan";
      else if (countryKey === "USA") countryName = "United States";

      countryCodeMap[countryKey] = countryName;
    });

    localStorage.setItem("countryCodeMap", JSON.stringify(countryCodeMap));
  }

  // set options for the select element
  const select = document.getElementById("countries_selector");

  select.innerHTML = Object.keys(countryCodeMap).map((countryKey) => {
    return (
      '<option value="' +
      countryKey +
      '"' +
      `${countryKey === "USA" ? "selected" : ""}>` +
      `${countryCodeMap[countryKey]}` +
      "</option>"
    );
  });
  try {
    select.loadOptions();
  } catch (err) {
    // known error with multi-select library - loadOptions()
  }
};

function updateCountrySelections() {
  var selectedValues = Array.prototype.slice
    .call(document.querySelectorAll("#countries_selector option:checked"), 0)
    .map(function (v, i, a) {
      return v.value;
    });

  svG.selectAll("*").remove();
  loadAndRenderGraph(selectedValues);
}

const margin = { top: 50, right: 50, bottom: 30, left: 50 },
  width = 800 - margin.left - margin.right,
  height = 400 - margin.top - margin.bottom;

const svG = d3
  .select("#line_graph")
  .append("svg")
  .attr("width", width + margin.left + margin.right)
  .attr("height", height + margin.top + margin.bottom)
  .append("g")
  .attr("transform", "translate(" + margin.left + "," + margin.top + ")");

addCountryOptions().then(() => {
  // default - US
  loadAndRenderGraph(["USA"]);
});
