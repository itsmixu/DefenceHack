*61N CHALLENGE:*
The Challenge

Automate intelligence preparation of the battlefield using open-source data.
INTRODUCTION TO THE CHALLENGE:

To maintain the pace in data intensive era, modern operational planning demands rapid, comprehensive environmental situational awareness of any given area of operations. The IPB (intelligence preparation of battlespace), a cornerstone of military doctrine, has been a fundamental process in modern combat operations and planning. It functions as the preliminary process that kick-starts military operation planning and execution. In a nutshell, the process aims to gather and synthesize vast amounts of data about terrain, weather, infrastructure, population, and more.

Until now, the process has been largely manual, which induces several weaknesses: the data is not up to date, it is not thorough, the process takes time, and uses resources that would be needed elsewhere. The process typically takes 2–4 weeks and produces inconsistent results depending on the target area, analysts and other resources. The focus easily drifts into data collection and preprocessing instead of analysis and evaluation of impacts and outcomes.

61N is bringing this challenge to Junction because we believe AI and automation can fundamentally transform how operational planners build situational awareness from open-source data.
Challenge description

Your task is to build a tool that, given a geographic area and timeframe, automatically retrieves, processes, and visualizes all operationally relevant open-source data for that area.

The tool should present the information in a human-digestible format — such as an interactive map, dashboard, or combined view — that enables a planning team to rapidly understand the operational environment.

The target areas for this challenge are: Archipelago Sea (1), North Karelia (2), and Lapland (Käsivarren Lappi) (3) showcased in Figure 1. These designated target areas are exemplary: an ideal solution would be generalizable: capable of producing a comparable intelligence picture for any area in the world, not just the specified regions. In this case, the user interface should also transparently show which data sources were available and which were not, to make the automated analysis explainable and transparent for the analysts and decision-makers.

Figure 1: Exemplary target areas for analysis Map of the target areas

The deliverable/final product could be a map visualization showcasing relevant datapoints like bridges, resources etc. and with a dashboard of relevant statistics.

Other data that is typically relevant for traditional IPB, as well as the process as a whole, can be looked at IPB documentation:

https://www.marines.mil/Portals/1/Publications/MCRP%202-10B.1.pdf

https://irp.fas.org/doddir/army/atp2-01-3.pdf

ABOUT THE COMPANY

61N is a pioneering Finnish defense and security technology company at the forefront of building critical information systems for national security. Known as the digital pioneer of national security, 61N delivers tailored, mission-critical solutions for defense forces and public safety organizations.

The company combines deep domain expertise in defense operations with modern, agile software development to create systems that protect nations and save lives. 61N is participating in the Junction Defence Hackathon to discover bold new approaches to automating intelligence processes and to connect with the next generation of innovators who want to make a real impact on national and international security.
Insight
INITIAL ANALYSIS:

We are looking for solutions that address the following data categories.

Primary requirements: terrain and topography (elevation, land cover, forest density, key terrain features, routes, water bodies and rivers), weather and climate (current conditions, forecasts, historical patterns, visibility), infrastructure (road networks, bridge load capacities, cell tower locations and coverage, logistic chokepoints, power grid, water supply, health care facilities), and population demographics (civilian population density, urban vs. rural distribution, political and religious factors, age and gender distribution etc).

The requirement does not dictate the analysis to map the data into other restrictions and caveats, but the developed system should enable connecting the data into further analysis. For example, certain weather conditions like rain and high wind speed hamper the use of certain drones.

Secondary requirements: satellite overpass schedules and surveillance windows, resource locations (water sources, supply points), political and social data (administrative boundaries, key institutions), and visibility/concealment analysis (line-of-sight, cover from observation). Participants are encouraged to go beyond these categories and bring creative, out-of-the-box data sources and derived insights into their solutions. Do not get fixated solely on the current description of IPB processes.

As an example, the data should answer (to an extent) the following questions:

    Where can forces (own and adversary) move, how fast, how far, what kind of cover does the terrain provide?

    What does the terrain enable for defensive preparations (fortifications, cover), communications, covert operations (protection against air surveillance, satellite surveillance, electronic intelligence)

    How is the weather assumed to impact the area in the following X days?

    What are the choke points for logistics and support? How can forces be supported with logistic and medical support?

    What are the non-military components in the area, in quantity and quality (are civilians present and in what capacity)

Resources

Participants will work with publicly available open-source data and are encouraged to scrape, combine, and derive insights from as many sources as possible. To guide your work, the aforementioned US Marine Corps IPB reference document describes the full IPB process and the types of information that operational planners require.

Key data sources to get started with include:

1) National Land Survey of Finland maanmittauslaitos.fi/en for topographic data

2) Finnish Meteorological Institute Open Data en.ilmatieteenlaitos.fi/open-data for weather and climate, and/or Windy for current and forecasted weather data

3) Statistics Finland stat.fi for population and demographics 4) Digiroad / Finnish Transport Infrastructure Agency vayla.fi/en for road and bridge infrastructure

5) OpenCelliD opencellid.org and CellMapper cellmapper.net for cell tower locations

6) N2YO n2yo.com for satellite tracking and orbit predictions.

Additionally, you are free to use any additional open-source data, APIs, or AI tools at your disposal.

The IPB process is defined in the US Marine Corps publication MCRP 2-10B.1 (Intelligence Preparation of the Battlespace, July 2023), available at marines.mil (links provided afore). This document describes the comprehensive process for gathering and analyzing information about an area of operations. While the full IPB process includes classified intelligence sources, this challenge focuses exclusively on what can be achieved with publicly available, open-source data.